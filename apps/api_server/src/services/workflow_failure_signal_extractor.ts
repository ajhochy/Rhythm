/**
 * workflow_failure_signal_extractor.ts — issue #933 (workflow-failure-signals-01).
 *
 * READ-ONLY extractor that scans recent `agent_sessions` /
 * `agent_session_messages` (plus the existing `denied_tool_events` telemetry)
 * for recurring agent-workflow failure patterns, so the Org Optimizer
 * (org_audit_service.ts / org_optimizer_run_service.ts) can act on them. V1 is
 * intentionally boring per the issue: regex/structured-message checks only —
 * no LLM classifier, no schema change, no writes, no proposal creation here.
 *
 * Signal categories (see WorkflowFailureCategory):
 *   - delegate-result: a delegated (task-tool subagent) session's outcome —
 *     see the "important nuance" note on {@link classifyDelegateOutcome}.
 *   - retry-loop, hallucinated-claim, unverified-claim, tool-unavailable-
 *     attempted, repeated-correction: regex/structured-message checks over
 *     session transcripts.
 *   - stale-redo: the same issue-numbered task worked more than once.
 *   - missing-scope: sourced from the EXISTING `denied_tool_events` table
 *     (structured, not regex) — a dispatch-guard denial is already exactly
 *     the "missing MCP/skill scope" signal; no need to re-derive it from text.
 *
 * Important nuance (delegate-result): an empty/short PARENT-visible result is
 * not proof the delegated (child) session failed — the child's OWN session
 * status + messages are the ground truth. See {@link classifyDelegateOutcome}.
 *
 * Safeguards (feed the #936 dedup/cap/stale-fixed work downstream):
 *   - missing-scope skips a denial whose tool name is ALREADY present in the
 *     profile's CURRENT live allowlist — the gap has since been fixed.
 *   - stale-redo skips an issue-number group whose MOST RECENT attempt
 *     reached a clean terminal (non-error) status — the redo pattern has
 *     resolved itself.
 *   - 'unknown' delegate-result evidence is surfaced at 'low' confidence,
 *     never escalated — callers (org-optimizer generators) must not turn a
 *     low-confidence/unknown signal into a high-confidence failure proposal.
 *   - One-off (count=1) evidence only produces a signal when the category is
 *     unambiguous/severe on its own (explicit denial, explicit session
 *     error, or a single session with a high in-session repeat count);
 *     everything else requires a repeat pattern (WORKFLOW_SIGNAL_MIN_REPEAT_COUNT).
 *
 * Operational envelope (mirrors org_audit_service.ts / the generators):
 *   • NEVER throws — a failing detector is logged and skipped, never fatal.
 *   • Performs NO database writes and creates NO proposals directly.
 *   • Scoped to a bounded recent-session window (WORKFLOW_SIGNAL_SESSION_SCAN_LIMIT)
 *     and capped total output (WORKFLOW_SIGNAL_MAX_PER_RUN) to avoid
 *     performance impact on active users.
 */

import { createHash } from 'crypto';
import { logger } from '../utils/logger';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { AgentSessionMessagesRepository } from '../repositories/agent_session_messages_repository';
import { DeniedToolEventsRepository } from '../repositories/denied_tool_events_repository';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { isToolAllowed } from './mcp_dispatch_guard';
import type { AgentSession, AgentSessionMessage, AgentSessionStatus } from '../models/agent_session';

// ── Public shapes ────────────────────────────────────────────────────────

export type WorkflowFailureCategory =
  | 'delegate-result'
  | 'retry-loop'
  | 'hallucinated-claim'
  | 'unverified-claim'
  | 'stale-redo'
  | 'missing-scope'
  | 'tool-unavailable-attempted'
  | 'repeated-correction'
  | 'external-abort';

/**
 * Only present when category='delegate-result'. See {@link classifyDelegateOutcome}
 * for what each value means and why 'unknown' must never be treated as a failure.
 */
export type DelegateOutcome = 'failed' | 'transport-empty' | 'incomplete' | 'unknown';

/**
 * Only present when category='retry-loop'. 'recovered' means the LAST
 * attempt of the repeated tool eventually completed; 'unresolved' means it
 * did not (still failed/timed-out, or never got a terminal attempt at all).
 * See {@link detectRetryLoopSignals}.
 */
export type RetryOutcome = 'recovered' | 'unresolved';

export type SignalConfidence = 'low' | 'medium' | 'high';

export interface WorkflowFailureSignal {
  category: WorkflowFailureCategory;
  /** Session ids backing this signal (capped to a handful for a concise evidence string). */
  sessionIds: string[];
  /** agent_configs.id when a profile could be attributed; null otherwise. */
  agentConfigId: string | null;
  /** How many occurrences (sessions or events, depending on category) back this signal. */
  count: number;
  confidence: SignalConfidence;
  /** Concise, human-readable evidence string (doubles as a proposal rationale/signal_ref). */
  evidence: string;
  delegateOutcome?: DelegateOutcome;
  retryOutcome?: RetryOutcome;
  /**
   * #936 — STABLE identity of the specific pattern this signal represents:
   * the detector's own grouping key (issue number for stale-redo, profile for
   * the profile-grouped categories, session id for a single-session severe
   * incident, profile:tool for missing-scope). Downstream proposal dedup keys
   * incorporate this so re-running over the SAME pattern collapses to the
   * existing proposal, while two DIFFERENT patterns of the same category
   * (e.g. stale-redo of issue #12 vs #34) never wrongly collide. Distinct
   * from `agentConfigId` precisely because stale-redo groups by issue, not
   * profile — profile alone (empty for agent-less sessions) collided every
   * stale-redo into one dedup key.
   */
  dedupToken: string;
}

export interface WorkflowFailureExtractorDeps {
  sessionsRepo?: AgentSessionsRepository;
  messagesRepo?: AgentSessionMessagesRepository;
  deniedToolEventsRepo?: DeniedToolEventsRepository;
  configsRepo?: AgentConfigsRepository;
}

// ── Tunables (env-overridable, mirrors org_audit_service.ts's #857 knobs) ──

/** How many of the most-recent sessions to scan per run. */
export const WORKFLOW_SIGNAL_SESSION_SCAN_LIMIT = Number(
  process.env.WORKFLOW_SIGNAL_SESSION_SCAN_LIMIT ?? 200,
);
/** Minimum repeat count before an ambiguous/inferred pattern is worth a signal. */
export const WORKFLOW_SIGNAL_MIN_REPEAT_COUNT = Number(
  process.env.WORKFLOW_SIGNAL_MIN_REPEAT_COUNT ?? 2,
);
/** V1 cap on total signals returned per run (issue #933's "e.g. 10"). */
export const WORKFLOW_SIGNAL_MAX_PER_RUN = Number(process.env.WORKFLOW_SIGNAL_MAX_PER_RUN ?? 10);

/** An in-flight delegated session with no activity this long looks abandoned, not merely slow. */
const STALE_IN_FLIGHT_MS = 30 * 60 * 1000;
/** Minimum stripped-text length to count as "real" delegated output (vs. a stray whitespace row). */
const MIN_OUTPUT_CHARS = 20;
/**
 * W3 (self-improvement-engine-foundation) — a tool call still `state.status
 * === 'running'` this long past its recorded `state.time.start` looks stuck/
 * timed-out, not merely slow. Mirrors STALE_IN_FLIGHT_MS's approach but scoped
 * to a single tool call rather than a whole delegated session.
 */
const STUCK_TOOL_RUNNING_MS = 10 * 60 * 1000;

// ── Shared regexes ──────────────────────────────────────────────────────

const CLAIM_RE =
  /\b(?:commit [0-9a-f]{7,40}|(?:pull request|pr) #\d+|pushed (?:it |this |that )?to (?:branch|main|origin))\b/i;
const CORRECTION_RE =
  /\b(?:that'?s? (?:not|n't) (?:right|correct|true)|that'?s incorrect|you'?re wrong|didn'?t work|still (?:broken|failing|wrong)|not what i (?:asked|meant)|doesn'?t exist|don'?t see (?:that|it|any))\b/i;
const VERIFY_CLAIM_RE =
  /\b(?:tests? (?:all |are )?pass(?:ed|ing)?|verification (?:complete|passed)|all (?:checks|tests) (?:pass|green)|verified (?:successfully)?)\b/i;
const ACTUAL_RUN_RE = /\b(?:npm (?:run )?test|vitest run|pytest|go test|tsc --noemit|jest\b|npm run build)\b/i;
const UNAVAILABLE_RE =
  /\b(?:tool unavailable|not connected|connection refused|econnrefused|failed to connect|server (?:is )?(?:down|unreachable))\b/i;
const ATTEMPT_RE = /\b(?:attempt(?:ing)?|try(?:ing)?|retry(?:ing)?|let me try)\b/i;
const ISSUE_NUM_RE = /#(\d{1,6})\b/;

const RUNNING_STATUSES = new Set<AgentSessionStatus>(['starting', 'working']);
const SUCCESS_TERMINAL_STATUSES = new Set<AgentSessionStatus>(['idle', 'closed', 'resumable']);

function parseJsonStringArray(json: string | null): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function profileOf(session: AgentSession): string | null {
  return session.mcpRole ?? session.agentKind ?? null;
}

// ── Detector 1: delegate-result ─────────────────────────────────────────

/**
 * Classify a delegated (task-tool subagent) session's outcome. The important
 * nuance from issue #933: an empty/short result visible to the PARENT is not
 * proof the delegated session failed — the child's OWN status/messages are
 * the ground truth checked here.
 *
 * Returns null when the child looks like a genuine success (terminal,
 * non-error, with real recorded output) — that is NOT a failure signal.
 */
function classifyDelegateOutcome(
  child: AgentSession,
  getMessages: (sessionId: string) => AgentSessionMessage[],
): DelegateOutcome | null {
  if (child.status === 'error') return 'failed';

  if (!RUNNING_STATUSES.has(child.status)) {
    const hasRealOutput = getMessages(child.id).some(
      (m) => m.role === 'output' && m.strippedText.trim().length >= MIN_OUTPUT_CHARS,
    );
    return hasRealOutput ? null : 'transport-empty';
  }

  // Still running — only a signal if it looks abandoned, never merely "in progress".
  const lastActivity = child.lastActivityAt ?? child.updatedAt;
  const staleMs = Date.now() - new Date(lastActivity).getTime();
  return staleMs > STALE_IN_FLIGHT_MS ? 'incomplete' : 'unknown';
}

function detectDelegateResultSignals(
  sessions: AgentSession[],
  getMessages: (sessionId: string) => AgentSessionMessage[],
): WorkflowFailureSignal[] {
  const groups = new Map<string, { agentConfigId: string | null; outcome: DelegateOutcome; sessionIds: string[] }>();

  for (const child of sessions) {
    if (!child.parentSessionId) continue;
    const outcome = classifyDelegateOutcome(child, getMessages);
    if (!outcome) continue; // real success — not a failure signal

    const agentConfigId = profileOf(child);
    const key = `${agentConfigId ?? '(unattributed)'}::${outcome}`;
    const entry = groups.get(key) ?? { agentConfigId, outcome, sessionIds: [] };
    entry.sessionIds.push(child.id);
    groups.set(key, entry);
  }

  const signals: WorkflowFailureSignal[] = [];
  for (const { agentConfigId, outcome, sessionIds } of groups.values()) {
    // 'failed' and 'transport-empty' are explicit, unambiguous failure evidence
    // — severe enough to signal on a single occurrence. 'incomplete'/'unknown'
    // are inferred from timing/staleness and need a repeat pattern.
    const singleOccurrenceIsSevere = outcome === 'failed' || outcome === 'transport-empty';
    if (!singleOccurrenceIsSevere && sessionIds.length < WORKFLOW_SIGNAL_MIN_REPEAT_COUNT) continue;

    const confidence: SignalConfidence =
      outcome === 'failed' ? 'high' : outcome === 'unknown' ? 'low' : 'medium';

    signals.push({
      category: 'delegate-result',
      delegateOutcome: outcome,
      agentConfigId,
      count: sessionIds.length,
      confidence,
      sessionIds: sessionIds.slice(0, 5),
      evidence: `delegateOutcome=${outcome} agentConfigId=${agentConfigId ?? '(unattributed)'} count=${sessionIds.length} sessionIds=${sessionIds.slice(0, 5).join(',')}`,
      dedupToken: agentConfigId ?? '(unattributed)', // grouped by profile+outcome; outcome added in the generator suffix
    });
  }
  return signals;
}

// ── Detector 2: retry-loop (W3 — structured tool attempts ONLY) ──────────
//
// Evidence comes exclusively from persisted `type: 'tool'` message parts
// (tool name + callID + state.status + state.input) — the SAME structured
// records org_exercised_tools_resolver.ts and async_delegation_status_service.ts
// read. Lexical "retry"/"try again" prose is NEVER scanned: a session can
// discuss retry policy, resume behavior, or narrate a successful retry in
// prose without that ever being mistaken for evidence — only an actual
// repeated, failed/timed-out tool invocation with MATERIALLY EQUIVALENT input
// counts. A read-only audit of live sessions found grouping by tool name
// alone flagged 700 same-session/tool groups, of which only 36 had a later
// exact-input retry — the other 664 were the same tool called with a
// different input, i.e. a different operation, not a retry.

type ToolAttemptStatus = 'pending' | 'running' | 'completed' | 'error';

interface ToolAttempt {
  tool: string;
  callId: string;
  status: ToolAttemptStatus;
  /** `state.time.start`, ms epoch. null when the part carries no timing. */
  startedAt: number | null;
  /**
   * SHA-256 identity of `state.input`, canonicalized (recursively key-sorted
   * JSON) so key-order differences never split one retry pattern into two.
   * The raw input is never logged, returned, or persisted — only this hash.
   */
  inputHash: string;
}

const TOOL_ATTEMPT_STATUSES = new Set<string>(['pending', 'running', 'completed', 'error']);

/** Recursively key-sorted JSON serialization — a stable basis for a content-equality hash. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Stable in-memory identity for a tool call's input. Never exposes the input itself. */
function hashInput(input: unknown): string {
  return createHash('sha256').update(canonicalJson(input)).digest('hex');
}

/**
 * Parse persisted tool-call parts out of a session's messages. A part is only
 * trusted as a real attempt when it carries a call identity (`callID`), a
 * recognized `state.status`, AND a recorded `state.input` — anything less
 * (missing identity, missing state, an unrecognized status, no input) is
 * SUPPRESSED here rather than guessed at, so a malformed/legacy part can
 * never manufacture retry-loop evidence.
 *
 * Duplicate persisted records of the SAME call (`callID`) — e.g. from a
 * reconnect/replay writing the part into more than one message row — are
 * collapsed to one final representation per call identity before returning,
 * so a repeated record of one call can never look like a second attempt.
 */
function extractToolAttempts(messages: AgentSessionMessage[]): ToolAttempt[] {
  const byCallId = new Map<string, ToolAttempt>();
  for (const m of messages) {
    if (!m.partsJson) continue;
    let parts: unknown;
    try {
      parts = JSON.parse(m.partsJson);
    } catch {
      continue;
    }
    if (!Array.isArray(parts)) continue;

    for (const raw of parts) {
      if (!raw || typeof raw !== 'object') continue;
      const part = raw as Record<string, unknown>;
      if (part.type !== 'tool') continue;

      const tool = typeof part.tool === 'string' ? part.tool : null;
      const callId = typeof part.callID === 'string' ? part.callID : null;
      const state = part.state as Record<string, unknown> | undefined;
      const status = typeof state?.status === 'string' ? state.status : null;
      if (!tool || !callId || !status || !TOOL_ATTEMPT_STATUSES.has(status)) continue;
      if (!state || !Object.prototype.hasOwnProperty.call(state, 'input')) continue;

      const time = state.time as Record<string, unknown> | undefined;
      const startedAt = typeof time?.start === 'number' ? time.start : null;
      byCallId.set(callId, { tool, callId, status: status as ToolAttemptStatus, startedAt, inputHash: hashInput(state.input) });
    }
  }
  return Array.from(byCallId.values());
}

type ToolAttemptResult = 'failed' | 'timeout' | 'ok' | 'in-flight';

/** Classify one attempt. A stale 'running' attempt (see STUCK_TOOL_RUNNING_MS) counts as a timeout. */
function classifyToolAttempt(attempt: ToolAttempt, now: number): ToolAttemptResult {
  if (attempt.status === 'error') return 'failed';
  if (attempt.status === 'completed') return 'ok';
  if (attempt.status === 'running' && attempt.startedAt !== null && now - attempt.startedAt > STUCK_TOOL_RUNNING_MS) {
    return 'timeout';
  }
  return 'in-flight'; // pending, or running but not yet stale — not evidence either way
}

function detectRetryLoopSignals(
  sessions: AgentSession[],
  getMessages: (sessionId: string) => AgentSessionMessage[],
): WorkflowFailureSignal[] {
  const signals: WorkflowFailureSignal[] = [];
  const now = Date.now();

  for (const session of sessions) {
    const attempts = extractToolAttempts(getMessages(session.id));
    if (attempts.length === 0) continue; // no structured tool evidence — suppressed, no prose fallback

    // Grouped by tool + normalized input identity — NOT tool alone. The same
    // tool called with a materially different input is a different
    // operation, not a retry of the same one (see the module doc comment).
    const byToolAndInput = new Map<string, ToolAttempt[]>();
    for (const attempt of attempts) {
      const key = `${attempt.tool}::${attempt.inputHash}`;
      const list = byToolAndInput.get(key) ?? [];
      list.push(attempt);
      byToolAndInput.set(key, list);
    }

    for (const group of byToolAndInput.values()) {
      // "Materially repeated" requires the SAME tool with EQUIVALENT input to
      // have been attempted more than once — a single failure, however
      // severe, is not a retry.
      if (group.length < WORKFLOW_SIGNAL_MIN_REPEAT_COUNT) continue;

      // state.time.start (not message/row insertion order) is the authoritative
      // chronology — it is what the engine itself stamped on the attempt.
      const sorted = [...group].sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
      const results = sorted.map((a) => classifyToolAttempt(a, now));
      const badCount = results.filter((r) => r === 'failed' || r === 'timeout').length;
      if (badCount === 0) continue; // repeated calls with no failure/timeout — not a retry loop

      const retryOutcome: RetryOutcome = results[results.length - 1] === 'ok' ? 'recovered' : 'unresolved';
      const agentConfigId = profileOf(session);
      const tool = sorted[0].tool;
      const inputHashPrefix = sorted[0].inputHash.slice(0, 12);

      signals.push({
        category: 'retry-loop',
        agentConfigId,
        count: badCount,
        confidence: retryOutcome === 'unresolved' ? 'high' : 'medium',
        sessionIds: [session.id],
        retryOutcome,
        evidence: `tool='${tool}' inputHash=${inputHashPrefix} attempts=${sorted.length} failedOrTimeout=${badCount} outcome=${retryOutcome} agentConfigId=${agentConfigId ?? '(unattributed)'} sessionId=${session.id}`,
        // Keyed on session+tool+inputHash — a single materially-repeated
        // (tool, equivalent-input) pair within one session is itself
        // unambiguous, structured evidence (unlike the old lexical count,
        // which needed a cross-session repeat to be trustworthy).
        dedupToken: `${session.id}:${tool}:${inputHashPrefix}`,
      });
    }
  }
  return signals;
}

// ── Detector 3: hallucinated-claim ───────────────────────────────────────

function detectHallucinatedClaimSignals(
  sessions: AgentSession[],
  getMessages: (sessionId: string) => AgentSessionMessage[],
): WorkflowFailureSignal[] {
  const groupsByProfile = new Map<string, string[]>();

  for (const session of sessions) {
    let claimSeen = false;
    let contradicted = false;
    for (const m of getMessages(session.id)) {
      if (m.role === 'output' && CLAIM_RE.test(m.strippedText)) {
        claimSeen = true;
      } else if (claimSeen && m.role === 'input' && CORRECTION_RE.test(m.strippedText)) {
        contradicted = true;
        break;
      }
    }
    if (!contradicted) continue;

    const key = profileOf(session) ?? '(unattributed)';
    const list = groupsByProfile.get(key) ?? [];
    list.push(session.id);
    groupsByProfile.set(key, list);
  }

  const signals: WorkflowFailureSignal[] = [];
  for (const [key, sessionIds] of groupsByProfile) {
    if (sessionIds.length < WORKFLOW_SIGNAL_MIN_REPEAT_COUNT) continue;
    signals.push({
      category: 'hallucinated-claim',
      agentConfigId: key === '(unattributed)' ? null : key,
      count: sessionIds.length,
      confidence: 'medium',
      sessionIds: sessionIds.slice(0, 5),
      evidence: `agent claimed a specific commit/PR the user then contradicted, in ${sessionIds.length} session(s) agentConfigId=${key} sessionIds=${sessionIds.slice(0, 5).join(',')}`,
      dedupToken: key, // grouped by profile
    });
  }
  return signals;
}

// ── Detector 4: unverified-claim ─────────────────────────────────────────

function detectUnverifiedClaimSignals(
  sessions: AgentSession[],
  getMessages: (sessionId: string) => AgentSessionMessage[],
): WorkflowFailureSignal[] {
  const groupsByProfile = new Map<string, string[]>();

  for (const session of sessions) {
    let claims = false;
    let ran = false;
    for (const m of getMessages(session.id)) {
      if (m.role === 'output' && VERIFY_CLAIM_RE.test(m.strippedText)) claims = true;
      if (ACTUAL_RUN_RE.test(m.strippedText) || (m.partsJson && ACTUAL_RUN_RE.test(m.partsJson))) ran = true;
    }
    if (!claims || ran) continue;

    const key = profileOf(session) ?? '(unattributed)';
    const list = groupsByProfile.get(key) ?? [];
    list.push(session.id);
    groupsByProfile.set(key, list);
  }

  const signals: WorkflowFailureSignal[] = [];
  for (const [key, sessionIds] of groupsByProfile) {
    if (sessionIds.length < WORKFLOW_SIGNAL_MIN_REPEAT_COUNT) continue;
    signals.push({
      category: 'unverified-claim',
      agentConfigId: key === '(unattributed)' ? null : key,
      count: sessionIds.length,
      confidence: 'medium',
      sessionIds: sessionIds.slice(0, 5),
      evidence: `agent claimed verification with no matching test/build run recorded, in ${sessionIds.length} session(s) agentConfigId=${key} sessionIds=${sessionIds.slice(0, 5).join(',')}`,
      dedupToken: key, // grouped by profile
    });
  }
  return signals;
}

// ── Detector 5: stale-redo (already-fixed issue worked again) ───────────

function detectStaleRedoSignals(sessions: AgentSession[]): WorkflowFailureSignal[] {
  const groups = new Map<string, AgentSession[]>();
  for (const session of sessions) {
    const match = session.taskTitle ? ISSUE_NUM_RE.exec(session.taskTitle) : null;
    if (!match) continue;
    const list = groups.get(match[1]) ?? [];
    list.push(session);
    groups.set(match[1], list);
  }

  const signals: WorkflowFailureSignal[] = [];
  for (const [issueNumber, group] of groups) {
    if (group.length < WORKFLOW_SIGNAL_MIN_REPEAT_COUNT) continue;

    const sorted = [...group].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
    const latest = sorted[sorted.length - 1];

    // #936 stale-fixed safeguard: the MOST RECENT attempt at this issue
    // already reached a clean terminal state — the redo pattern has resolved
    // itself; do not keep flagging history that is no longer actionable.
    if (SUCCESS_TERMINAL_STATUSES.has(latest.status)) continue;

    signals.push({
      category: 'stale-redo',
      agentConfigId: profileOf(latest),
      count: group.length,
      confidence: latest.status === 'error' ? 'high' : 'medium',
      sessionIds: sorted.map((s) => s.id).slice(0, 5),
      evidence: `issue #${issueNumber} worked again across ${group.length} sessions; latest status=${latest.status} sessionIds=${sorted.map((s) => s.id).slice(0, 5).join(',')}`,
      // #936 — grouped by ISSUE NUMBER, not profile: the issue number is the
      // stable identity that keeps distinct issues from colliding into one
      // dedup key (profile alone is empty for agent-less sessions).
      dedupToken: `issue-${issueNumber}`,
    });
  }
  return signals;
}

// ── Detector 6: missing-scope (structured — denied_tool_events, not regex) ──

async function detectMissingScopeSignals(
  deniedRepo: DeniedToolEventsRepository,
  configsRepo: AgentConfigsRepository,
): Promise<WorkflowFailureSignal[]> {
  const events = await deniedRepo.listAllAsync();
  const groups = new Map<string, { toolName: string; agentConfigId: string; sessionIds: string[] }>();
  for (const event of events) {
    if (!event.agentConfigId) continue; // no profile to attribute — nothing actionable
    const key = `${event.agentConfigId}::${event.toolName}`;
    const entry = groups.get(key) ?? { toolName: event.toolName, agentConfigId: event.agentConfigId, sessionIds: [] };
    if (event.sessionId) entry.sessionIds.push(event.sessionId);
    groups.set(key, entry);
  }

  const signals: WorkflowFailureSignal[] = [];
  for (const entry of groups.values()) {
    const config = configsRepo.getById(entry.agentConfigId);
    if (!config) continue;

    // #936 stale-fixed safeguard: the scope has already been granted — the gap
    // this signal would report does not exist.
    //
    // A DENIAL IS NOT PROOF OF A MISSING GRANT. This check used to compare a
    // model-facing TOOL id ('gitnexus_query') against a list of SERVER names
    // parsed with a local array-only helper, so it matched nothing: it never
    // fired for the tools-map shape, and never for a tool id at all. Real
    // denials on in-scope tools (a dispatch-guard/scope disagreement) therefore
    // became "missing-scope" signals, which is how a profile that HAS gitnexus
    // got a high-risk "grant gitnexus" proposal filed against it. `isToolAllowed`
    // is the same predicate the dispatch guard enforces with, so "in scope"
    // means exactly what the runtime means by it.
    if (isToolAllowed(entry.toolName, config.allowedMcpsJson ?? null)) {
      logger.warn(
        `[workflow-failure-signals] denied tool '${entry.toolName}' IS within ${entry.agentConfigId}'s ` +
          `resolved MCP scope — not filing a missing-scope signal. The denial is real but its cause is ` +
          `not a missing grant (check the enforcing session's mcp_allowed_tools_json).`,
      );
      continue;
    }
    if (parseJsonStringArray(config.allowedSkillsJson).includes(entry.toolName)) continue;

    signals.push({
      category: 'missing-scope',
      agentConfigId: entry.agentConfigId,
      count: entry.sessionIds.length || 1,
      confidence: 'high', // explicit dispatch-guard denial — unambiguous
      sessionIds: entry.sessionIds.slice(0, 5),
      evidence: `profile=${entry.agentConfigId} deniedTool=${entry.toolName} count=${entry.sessionIds.length} sessionIds=${entry.sessionIds.slice(0, 5).join(',')}`,
      dedupToken: `${entry.agentConfigId}:${entry.toolName}`, // grouped by profile+tool (broaden-scope keys on these directly)
    });
  }
  return signals;
}

// ── Detector 7: tool-unavailable-attempted ───────────────────────────────

function detectToolUnavailableSignals(
  sessions: AgentSession[],
  getMessages: (sessionId: string) => AgentSessionMessage[],
): WorkflowFailureSignal[] {
  const groupsByProfile = new Map<string, string[]>();

  for (const session of sessions) {
    let sawUnavailable = false;
    let attemptedAfter = false;
    for (const m of getMessages(session.id)) {
      if (m.role !== 'output') continue;
      if (!sawUnavailable && UNAVAILABLE_RE.test(m.strippedText)) {
        sawUnavailable = true;
      } else if (sawUnavailable && ATTEMPT_RE.test(m.strippedText)) {
        attemptedAfter = true;
        break;
      }
    }
    if (!sawUnavailable || !attemptedAfter) continue;

    const key = profileOf(session) ?? '(unattributed)';
    const list = groupsByProfile.get(key) ?? [];
    list.push(session.id);
    groupsByProfile.set(key, list);
  }

  const signals: WorkflowFailureSignal[] = [];
  for (const [key, sessionIds] of groupsByProfile) {
    if (sessionIds.length < WORKFLOW_SIGNAL_MIN_REPEAT_COUNT) continue;
    signals.push({
      category: 'tool-unavailable-attempted',
      agentConfigId: key === '(unattributed)' ? null : key,
      count: sessionIds.length,
      confidence: 'medium',
      sessionIds: sessionIds.slice(0, 5),
      evidence: `an unavailable tool/server was still attempted after being reported unavailable, in ${sessionIds.length} session(s) agentConfigId=${key} sessionIds=${sessionIds.slice(0, 5).join(',')}`,
      dedupToken: key, // grouped by profile
    });
  }
  return signals;
}

// ── Detector 8: repeated-correction ──────────────────────────────────────

function detectRepeatedCorrectionSignals(
  sessions: AgentSession[],
  getMessages: (sessionId: string) => AgentSessionMessage[],
): WorkflowFailureSignal[] {
  const signals: WorkflowFailureSignal[] = [];
  const groupsByProfile = new Map<string, string[]>();

  for (const session of sessions) {
    const inputMessages = getMessages(session.id).filter((m) => m.role === 'input');
    if (inputMessages.length <= 1) continue; // need a first prompt + at least one follow-up

    const corrections = inputMessages.slice(1).filter((m) => CORRECTION_RE.test(m.strippedText));
    if (corrections.length === 0) continue;

    const agentConfigId = profileOf(session);
    if (corrections.length >= 3) {
      signals.push({
        category: 'repeated-correction',
        agentConfigId,
        count: corrections.length,
        confidence: 'high',
        sessionIds: [session.id],
        evidence: `${corrections.length} user corrections after the first prompt in one session agentConfigId=${agentConfigId ?? '(unattributed)'} sessionId=${session.id}`,
        dedupToken: session.id, // a single-session severe incident — keyed on the session itself
      });
    } else {
      const key = agentConfigId ?? '(unattributed)';
      const list = groupsByProfile.get(key) ?? [];
      list.push(session.id);
      groupsByProfile.set(key, list);
    }
  }

  for (const [key, sessionIds] of groupsByProfile) {
    if (sessionIds.length < WORKFLOW_SIGNAL_MIN_REPEAT_COUNT) continue;
    signals.push({
      category: 'repeated-correction',
      agentConfigId: key === '(unattributed)' ? null : key,
      count: sessionIds.length,
      confidence: 'medium',
      sessionIds: sessionIds.slice(0, 5),
      evidence: `repeated user corrections after the first prompt across ${sessionIds.length} sessions agentConfigId=${key} sessionIds=${sessionIds.slice(0, 5).join(',')}`,
      dedupToken: key, // grouped by profile
    });
  }
  return signals;
}

// ── Entry point ───────────────────────────────────────────────────────────

/**
 * Extract recurring workflow-failure signals from recent session/message
 * data. Read-only, never throws — see module doc comment. Caps output to
 * {@link WORKFLOW_SIGNAL_MAX_PER_RUN}, keeping the highest-confidence /
 * highest-count signals when more than the cap were detected.
 */
export async function extractWorkflowFailureSignals(
  deps: WorkflowFailureExtractorDeps = {},
): Promise<WorkflowFailureSignal[]> {
  try {
    const sessionsRepo = deps.sessionsRepo ?? new AgentSessionsRepository();
    const messagesRepo = deps.messagesRepo ?? new AgentSessionMessagesRepository();
    const deniedRepo = deps.deniedToolEventsRepo ?? new DeniedToolEventsRepository();
    const configsRepo = deps.configsRepo ?? new AgentConfigsRepository();

    const sessions = sessionsRepo.listAll(WORKFLOW_SIGNAL_SESSION_SCAN_LIMIT, { includeArchived: true });

    const messageCache = new Map<string, AgentSessionMessage[]>();
    const getMessages = (sessionId: string): AgentSessionMessage[] => {
      let cached = messageCache.get(sessionId);
      if (!cached) {
        cached = messagesRepo.listBySession(sessionId);
        messageCache.set(sessionId, cached);
      }
      return cached;
    };

    const signals: WorkflowFailureSignal[] = [];
    const syncDetectors: Array<() => WorkflowFailureSignal[]> = [
      () => detectDelegateResultSignals(sessions, getMessages),
      () => detectRetryLoopSignals(sessions, getMessages),
      () => detectHallucinatedClaimSignals(sessions, getMessages),
      () => detectUnverifiedClaimSignals(sessions, getMessages),
      () => detectStaleRedoSignals(sessions),
      () => detectToolUnavailableSignals(sessions, getMessages),
      () => detectRepeatedCorrectionSignals(sessions, getMessages),
    ];

    for (const detector of syncDetectors) {
      try {
        signals.push(...detector());
      } catch (err) {
        logger.warn(`[workflow-failure-extractor] a detector failed (non-fatal): ${String(err)}`);
      }
    }

    try {
      signals.push(...(await detectMissingScopeSignals(deniedRepo, configsRepo)));
    } catch (err) {
      logger.warn(`[workflow-failure-extractor] missing-scope detector failed (non-fatal): ${String(err)}`);
    }

    // Cap to the highest-severity signals: confidence desc, then count desc.
    const rank: Record<SignalConfidence, number> = { high: 2, medium: 1, low: 0 };
    signals.sort((a, b) => rank[b.confidence] - rank[a.confidence] || b.count - a.count);
    return signals.slice(0, WORKFLOW_SIGNAL_MAX_PER_RUN);
  } catch (err) {
    logger.warn(`[workflow-failure-extractor] FAILED (non-fatal): ${String(err)}`);
    return [];
  }
}

// Exported for direct unit testing of individual detectors in isolation.
export {
  classifyDelegateOutcome,
  detectDelegateResultSignals,
  detectRetryLoopSignals,
  extractToolAttempts,
  classifyToolAttempt,
  detectHallucinatedClaimSignals,
  detectUnverifiedClaimSignals,
  detectStaleRedoSignals,
  detectMissingScopeSignals,
  detectToolUnavailableSignals,
  detectRepeatedCorrectionSignals,
};
