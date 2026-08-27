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

import { logger } from '../utils/logger';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { AgentSessionMessagesRepository } from '../repositories/agent_session_messages_repository';
import { DeniedToolEventsRepository } from '../repositories/denied_tool_events_repository';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { isToolAllowed } from './mcp_dispatch_guard';
import { parsePersistedToolEvidence, type ToolAttempt } from './persisted_tool_evidence';
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
  | 'external-abort'
  | 'post-apply-regression';

/**
 * Only present when category='delegate-result'. See {@link classifyDelegateOutcome}
 * for what each value means and why 'unknown' must never be treated as a failure.
 */
export type DelegateOutcome = 'failed' | 'transport-empty' | 'incomplete' | 'unknown';

/**
 * Only present when category='retry-loop'. Only assigned once a failed/
 * timed-out attempt has been followed by a LATER attempt of the same
 * (tool, equivalent-input) pair AND the latest such attempt is terminal
 * (completed, or failed/timed-out) — a failure with no later attempt is not
 * a retry, and a latest attempt still in-flight (not stale) is inconclusive,
 * not evidence either way. 'recovered' means that latest attempt completed;
 * 'unresolved' means it was also failed/timed-out. See
 * {@link detectRetryLoopSignals}.
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
  /** Stable retry recurrence identity; present only for category='retry-loop'. */
  retryTool?: string;
  retryInputHash?: string;
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
export const STUCK_TOOL_RUNNING_MS = 10 * 60 * 1000;

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

/**
 * Narrow compatibility export for adjacent callers/tests — delegates entirely
 * to the shared `persisted_tool_evidence.ts` parser (the SAME parser
 * `classifyRerunFailure` in org_proposal_measure.ts consumes) so this module
 * and the rerun-measurement path can never drift into two incomplete,
 * hand-rolled validators again. Malformed/ambiguous evidence
 * (`integrity: 'invalid'`) is returned as an EMPTY attempt list here — never
 * silently certified clean — matching this function's pre-existing "no
 * evidence" contract for callers that only care about attempts, not integrity.
 */
function extractToolAttempts(messages: AgentSessionMessage[]): ToolAttempt[] {
  return parsePersistedToolEvidence(messages).attempts;
}

type ToolAttemptResult = 'failed' | 'timeout' | 'ok' | 'in-flight';

/**
 * Classify one attempt. A stale 'running' attempt settles AT (>=), not only
 * strictly past, STUCK_TOOL_RUNNING_MS — the boundary instant itself is
 * already a timeout, not one tick shy of it. A 'completed' state whose
 * `mcpResult.isError===true` is FAILED, not a recovered success.
 */
function classifyToolAttempt(attempt: ToolAttempt, now: number): ToolAttemptResult {
  if (attempt.status === 'error') return 'failed';
  if (attempt.status === 'completed') return attempt.mcpIsError ? 'failed' : 'ok';
  if (attempt.status === 'running' && attempt.startedAt !== null && now - attempt.startedAt >= STUCK_TOOL_RUNNING_MS) {
    return 'timeout';
  }
  return 'in-flight'; // pending, or running but not yet stale — not evidence either way
}

/**
 * The instant a TERMINAL attempt SETTLES — the earliest a subsequent attempt
 * could genuinely be "after" it. A completed/errored attempt settles at its
 * own `state.time.end`; a stale-running timeout settles no earlier than
 * `start + STUCK_TOOL_RUNNING_MS` (the instant it actually crossed the
 * staleness threshold, not "now"). `null` for a still in-flight attempt —
 * it never settles and can never anchor a later attempt's chronology.
 */
function settlementOf(attempt: ToolAttempt, result: ToolAttemptResult): number | null {
  if (result === 'failed' || result === 'ok') return attempt.endedAt;
  if (result === 'timeout') return (attempt.startedAt as number) + STUCK_TOOL_RUNNING_MS;
  return null;
}

export interface RetryTimelineResult {
  retryOutcome: RetryOutcome;
  badCount: number;
}

/**
 * The ONE deterministic terminal-timeline reducer for a single (tool,
 * equivalent-input) group of attempts within a session. Consumed exclusively
 * by {@link detectRetryLoopSignals} (rerun measurement reaches the SAME
 * strict evidence through `detectRetryLoopSignals` itself for its
 * "reproduced" check — see org_proposal_measure.ts's classifyRerunFailure).
 *
 * Fails closed (`null`, no signal) whenever the timeline is not FULLY
 * strict and terminal:
 *   - fewer than WORKFLOW_SIGNAL_MIN_REPEAT_COUNT attempts;
 *   - any attempt lacks a finite `startedAt` (a 'pending' attempt never has
 *     one — sorting a missing timestamp against real ones can manufacture an
 *     ordering that was never observed);
 *   - ANY attempt (not merely the last) is still in-flight (pending, or
 *     running but not yet stale) — an unsettled attempt anywhere makes the
 *     whole timeline provisional;
 *   - the sorted-by-start sequence is not STRICTLY non-overlapping: each
 *     attempt's start must be strictly greater than the PRIOR attempt's own
 *     settlement (not "any prior failure's" — this closes the prior bug
 *     where a later attempt could chain past an intermediate attempt that
 *     itself overlapped an earlier unsettled failure, manufacturing
 *     causality that was never actually sequential). Equal starts and
 *     overlaps suppress the whole group.
 *
 * Only once every attempt is finite, terminal, and strictly sequential does
 * this derive recovered/unresolved — from the FINAL attempt in that strict
 * chronology, requiring at least one earlier failed/timeout attempt.
 */
export function reduceRetryTimeline(group: ToolAttempt[], now: number): RetryTimelineResult | null {
  if (group.length < WORKFLOW_SIGNAL_MIN_REPEAT_COUNT) return null;
  if (!group.every((a) => typeof a.startedAt === 'number' && Number.isFinite(a.startedAt))) return null;

  const sorted = [...group].sort((a, b) => (a.startedAt as number) - (b.startedAt as number));
  const results = sorted.map((a) => classifyToolAttempt(a, now));

  if (results.some((r) => r === 'in-flight')) return null;

  for (let i = 1; i < sorted.length; i++) {
    const priorSettlement = settlementOf(sorted[i - 1], results[i - 1]);
    if (priorSettlement === null || (sorted[i].startedAt as number) <= priorSettlement) return null;
  }

  const hasQualifyingRetry = results.slice(0, -1).some((r) => r === 'failed' || r === 'timeout');
  if (!hasQualifyingRetry) return null;

  const lastResult = results[results.length - 1];
  const badCount = results.filter((r) => r === 'failed' || r === 'timeout').length;
  const retryOutcome: RetryOutcome = lastResult === 'ok' ? 'recovered' : 'unresolved';
  return { retryOutcome, badCount };
}

function detectRetryLoopSignals(
  sessions: AgentSession[],
  getMessages: (sessionId: string) => AgentSessionMessage[],
): WorkflowFailureSignal[] {
  const signals: WorkflowFailureSignal[] = [];
  const now = Date.now();

  for (const session of sessions) {
    const attempts = parsePersistedToolEvidence(getMessages(session.id)).attempts;
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
      const timeline = reduceRetryTimeline(group, now);
      if (!timeline) continue;
      const { retryOutcome, badCount } = timeline;

      const agentConfigId = profileOf(session);
      const tool = group[0].tool;
      const inputHash = group[0].inputHash;
      const inputHashPrefix = inputHash.slice(0, 12);

      signals.push({
        category: 'retry-loop',
        agentConfigId,
        count: badCount,
        confidence: retryOutcome === 'unresolved' ? 'high' : 'medium',
        sessionIds: [session.id],
        retryOutcome,
        retryTool: tool,
        retryInputHash: inputHash,
        evidence: `tool='${tool}' inputHash=${inputHashPrefix} attempts=${group.length} failedOrTimeout=${badCount} outcome=${retryOutcome} agentConfigId=${agentConfigId ?? '(unattributed)'} sessionId=${session.id}`,
        // Keyed on session+tool+FULL inputHash — a single materially-repeated
        // (tool, equivalent-input) pair within one session is itself
        // unambiguous, structured evidence (unlike the old lexical count,
        // which needed a cross-session repeat to be trustworthy). The full
        // hash (not the human-readable evidence's short prefix) is used here
        // so two genuinely different inputs can never collide onto one
        // dedup key.
        dedupToken: `${session.id}:${tool}:${inputHash}`,
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
