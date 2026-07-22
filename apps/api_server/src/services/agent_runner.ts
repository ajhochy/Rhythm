/**
 * AgentRunner — #738
 *
 * Thin orchestration wrapper over OpencodeClientService:
 *  1. Creates an opencode session (with optional role/mcp scoping)
 *  2. Calls promptAsync() to fire the prompt (non-blocking enqueue)
 *  3. Polls the session message list via the SDK until the assistant replies
 *     or a timeout fires
 *  4. Returns { sessionId, result, status }
 *
 * Concurrency cap: MAX_CONCURRENT_AGENT_RUNS (env, default 8)
 * Per-run timeout:  AGENT_RUN_TIMEOUT_MS      (env, default 600 000 ms)
 *
 * outputTarget (default 'session'):
 *   'session'      — leave result in the opencode session; no extra I/O
 *   'task_notes'   — PATCH the named task's notes with `result` (requires taskId)
 *   'notification' — TODO: POST to notifications path (best-effort; no-op for now)
 */

import { opencodeClient, opencodeSessionMap } from './opencode_engine';
import { logger } from '../utils/logger';
import { env } from '../config/env';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { AgentSessionMessagesRepository } from '../repositories/agent_session_messages_repository';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { queueSkillExtraction } from './skill_extractor';
import { scheduleIdleEvaluation } from './harvested_skill_evaluator';
import { buildSkillsPreface, isSkillInjectionEnabled } from './skill_retrieval';
import { buildMemoryPreface, isMemoryInjectionEnabled } from './memory_retrieval';
import { AgentSkillsRepository } from '../repositories/agent_skills_repository';
import { AgentSessionMemoryProvenanceRepository } from '../repositories/agent_session_memory_provenance_repository';
import { resolveProfileScope } from './agent_profile_scope';

// ── Environment caps (read per-call so tests can override via process.env) ────

function getMaxConcurrentRuns(): number {
  return Number(process.env.MAX_CONCURRENT_AGENT_RUNS ?? 8);
}

function getRunTimeoutMs(): number {
  return Number(process.env.AGENT_RUN_TIMEOUT_MS ?? 600_000);
}

/**
 * Grace window after promptAsync before we declare "no progress".
 * If listMessages returns zero messages within this window, the run is
 * aborted with a fast error rather than hanging to the full 600s timeout.
 * Default 20 000 ms; override with AGENT_RUN_NOPROGRESS_MS env var.
 */
function getNoProgressMs(): number {
  return Number(process.env.AGENT_RUN_NOPROGRESS_MS ?? 30_000);
}

class AgentRunTimeoutError extends Error {
  constructor(
    readonly stage: string,
    readonly timeoutMs: number,
  ) {
    super(`Run timed out during ${stage} after ${timeoutMs}ms`);
    this.name = 'AgentRunTimeoutError';
  }
}

/**
 * Run one engine call within the shared AgentRunner deadline. Every stage uses
 * the same deadline so MCP readiness and session creation cannot consume an
 * unbounded amount of time before prompt() gets its timeout race.
 */
async function _withinRunDeadline<T>(
  operation: Promise<T>,
  deadline: number,
  stage: string,
): Promise<T> {
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) {
    throw new AgentRunTimeoutError(stage, getRunTimeoutMs());
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new AgentRunTimeoutError(stage, getRunTimeoutMs())),
          remainingMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Headless runs do not consume the engine event stream, so they never receive
 * the interactive path's session.updated auto-title. Seed their session with a
 * cheap, stable title from the first prompt instead of leaving a placeholder.
 */
function _titleFromPrompt(prompt: string): string | null {
  const normalized = prompt.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;

  const MAX_TITLE_LENGTH = 80;
  return normalized.length <= MAX_TITLE_LENGTH
    ? normalized
    : `${normalized.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…`;
}

function _isSessionNamePlaceholder(name: string): boolean {
  const trimmed = name.trim();
  return (
    ['New session', 'AgentRunner run', 'Scheduled run'].includes(trimmed) ||
    trimmed.startsWith('Scheduled:')
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AgentRunOptions {
  prompt: string;
  /** Raw JSON string of allowed MCP tools (same shape as agent_sessions.allowed_mcps_json) */
  allowedMcpsJson?: string | null;
  /**
   * Raw JSON string of allowed skill ids/titles (the scope-inheritance change task-level override).
   * When provided it overrides the bound profile's allowed_skills_json for skill
   * injection; when undefined the profile's own allowlist is inherited. Mirrors
   * allowedMcpsJson's override-or-inherit semantics.
   */
  allowedSkillsJson?: string | null;
  /** MCP role slug (e.g. 'email-assistant') — parsed from .mcp-roles/<slug>.mcp.json */
  mcpRole?: string;
  /** Working directory for the opencode session */
  cwd?: string;
  /** Rhythm task ID for 'task_notes' delivery */
  taskId?: string | null;
  /** Where to deliver the agent result (default: 'session') */
  outputTarget?: 'session' | 'notification' | 'task_notes';
  /**
   * #738-fix — agent_configs.id to look up a preferred model for this run.
   * When provided, resolveRunModel() checks agent_configs.model_provider +
   * model_id first before falling back to the most-recently-used session model.
   */
  agentConfigId?: string | null;
  /**
   * #738-fix — agent kind label (e.g. 'claude-code') used as the agent_kind
   * on the recorded agent_sessions row. Defaults to 'claude-code' when absent.
   */
  agentKind?: string | null;
  /**
   * #738-fix — Human-readable session name shown in the CHATS list.
   * Falls back to "AgentRunner run" when omitted.
   */
  sessionName?: string | null;
  /**
   * #738-fix — FK to agent_scheduled_tasks.id for scheduler-originated runs.
   * Null for ad-hoc/cookbook runs.
   */
  scheduledTaskId?: string | null;
  /**
   * FOLLOW-UP (memory injection) — the owning user for this run, used to
   * OWNER-SCOPE memory retrieval so user A's facts never leak into user B's
   * prompt. For scheduler-originated runs this is
   * `agent_scheduled_tasks.created_by_user_id`. When null/undefined the run is
   * treated as having NO known owner → only instance-global (null-owner) memory
   * is injected (fail-safe; never cross-user). Skills are unaffected (shared).
   */
  ownerUserId?: number | null;
  /** Delegation nesting depth stored on agent_sessions for server-side delegation caps. */
  delegationDepth?: number;
  /**
   * USO B1 (#1028) — session category stamped on the recorded agent_sessions row.
   * Omit for the default derivation ('scheduled' when scheduledTaskId is set,
   * else 'chat'). Pass 'self_improvement' for curator/skill/memory background
   * runs — those stay is_system=1 and never surface in the default Chats view;
   * the category is what places them in the self_improvement scope.
   */
  category?: import('../models/agent_session').SessionCategory;
  /**
   * P4-1 (internal) — marks this run as the escalated (teacher) re-run so its
   * OWN error path does NOT escalate again. This is the recursion guard: the
   * escalated run carries `_isEscalation: true`, so {@link shouldEscalate}
   * returns false for it. Never set by external callers.
   */
  _isEscalation?: boolean;
  /**
   * When set, bypasses resolveRunModel() and forces this run to use the given
   * model. Two callers set it: (1) P4-1 teacher-escalation forces the stronger
   * teacher model on a re-run; (2) the scheduler (the model-override change) forwards a task's
   * per-task model_provider/model_id override. Precedence in _runOnce:
   * modelOverride > profile model (resolveRunModel) > hardcoded default.
   */
  modelOverride?: { providerID: string; modelID: string };
  /**
   * #844 (tokens-04) — optional task-kind hint ('triage' | 'formatting' |
   * 'extraction' | 'summarization' | 'planning' | 'judgment' | ...) used for
   * BUDGET-AWARE TIERED ROUTING via agent_model_resolver.resolveTieredModel().
   *
   * OPT-IN / additive: when omitted (the default for all existing callers),
   * model resolution is completely unchanged — `modelOverride > profile model
   * (resolveRunModel) > hardcoded default`, exactly as before. When provided,
   * `resolveTieredModel()` is layered ON TOP of that same precedence: it
   * still honors `modelOverride` first (never downgraded for budget), then
   * the profile's `model_tier_hint` (if set) or this task kind's default
   * tier, narrowed to the cheapest ADEQUATE authed route and downgraded
   * further if the target provider is near its usage budget. Every decision
   * is logged as one structured `[ModelRouting]` line (see #819 org audit).
   */
  taskKind?: string | null;
}

export interface AgentRunResult {
  sessionId: string;
  result: string;
  status: 'done' | 'error';
  error?: string;
  /** Machine-readable classification for errors callers may safely retry. */
  errorCode?: 'capacity';
}

// ── In-process concurrency gate ───────────────────────────────────────────────

const _activeRuns = new Set<string>();

function _acquireSlot(id: string): boolean {
  if (_activeRuns.size >= getMaxConcurrentRuns()) return false;
  _activeRuns.add(id);
  return true;
}

function _releaseSlot(id: string): void {
  _activeRuns.delete(id);
}

// Exported for testing only
export function _activeRunCount(): number {
  return _activeRuns.size;
}

// ── Prompt result extraction ──────────────────────────────────────────────────

/**
 * Poll the session's message list until we find an assistant message newer than
 * `afterTimestamp`, or until `deadline` is reached.
 *
 * Strategy: the SDK `session.messages` endpoint returns all messages in the
 * session ordered by time. We wait for a message whose `role === 'assistant'`
 * and whose `time.created` is >= our prompt submission time. This is simpler
 * than subscribing to SSE inside a background runner where we don't have a live
 * HTTP connection to stream from.
 *
 * Poll interval: 500 ms — low enough to be responsive, high enough to avoid
 * flooding the local opencode process.
 */
async function _waitForAssistantReply(
  sessionId: string,
  afterTimestamp: number,
  deadline: number,
): Promise<string | null> {
  const POLL_INTERVAL_MS = 500;

  while (Date.now() < deadline) {
    try {
      const messages = await opencodeClient.listMessages(sessionId);
      // Find the last assistant message created after our prompt was sent
      const assistantMessages = messages.filter(
        (m) =>
          m.role === 'assistant' &&
          (m.time?.created ?? 0) >= afterTimestamp,
      );
      if (assistantMessages.length > 0) {
        const last = assistantMessages[assistantMessages.length - 1];
        // Extract text from parts — SDK Part is a discriminated union; pick type='text'
        const textParts = (last.parts ?? []).filter(
          (p): p is import('@opencode-ai/sdk').TextPart => p.type === 'text',
        );
        if (textParts.length > 0) {
          return textParts.map((p) => p.text).join('\n').trim();
        }
        // Non-text assistant turn (tool calls only) — keep waiting
      }
    } catch {
      // listMessages throws on SDK error — swallow transient errors and retry
    }

    await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  return null; // timeout
}

// ── Model resolution ──────────────────────────────────────────────────────────

/**
 * #738-fix: Resolve a {providerID, modelID} pair for an agent run.
 *
 * Resolution order:
 *  1. agent_configs row with matching id → use model_provider + model_id if set.
 *  2. Most-recently-used model from agent_sessions (any session with provider_id
 *     + model_id populated, ordered by created_at DESC).
 *  3. Hardcoded sensible default: anthropic / claude-sonnet-4-6.
 *
 * The function never throws. Returns undefined only if the DB call itself
 * fails — in that case the caller should use the hardcoded default instead
 * (handled by the fallthrough to step 3).
 */
export function resolveRunModel(
  agentConfigId?: string | null,
): { providerID: string; modelID: string } {
  // Step 1 — agent config preference
  if (agentConfigId) {
    try {
      const config = new AgentConfigsRepository().getById(agentConfigId);
      if (config?.modelProvider && config?.modelId) {
        logger.info(
          `[AgentRunner] resolveRunModel: using agent config ${agentConfigId} model (${config.modelProvider}/${config.modelId})`,
        );
        return { providerID: config.modelProvider, modelID: config.modelId };
      }
    } catch (err) {
      logger.warn(`[AgentRunner] resolveRunModel: agent config lookup failed: ${String(err)}`);
    }
  }

  // Step 2 — most-recently-used from any session
  try {
    const mru = new AgentSessionsRepository().findMostRecentlyUsedModel();
    if (mru) {
      logger.info(
        `[AgentRunner] resolveRunModel: using most-recently-used model (${mru.providerID}/${mru.modelID})`,
      );
      return mru;
    }
  } catch (err) {
    logger.warn(`[AgentRunner] resolveRunModel: MRU lookup failed: ${String(err)}`);
  }

  // Step 3 — hardcoded default so a run never silently hangs on undefined
  const DEFAULT_PROVIDER = 'anthropic';
  const DEFAULT_MODEL = 'claude-sonnet-4-6';
  logger.info(
    `[AgentRunner] resolveRunModel: no agent config or MRU model found — using default (${DEFAULT_PROVIDER}/${DEFAULT_MODEL})`,
  );
  return { providerID: DEFAULT_PROVIDER, modelID: DEFAULT_MODEL };
}

// ── Session recording ─────────────────────────────────────────────────────────

/**
 * #738-fix: Record this AgentRunner run in agent_sessions so the CHATS list
 * surfaces scheduler-originated runs.
 *
 * Returns the created session id, or null if the insert fails (non-fatal —
 * the run can still proceed without a DB record).
 */
function _recordSession(opts: {
  name: string;
  agentKind: string;
  cwd: string;
  scheduledTaskId?: string | null;
  mcpRole?: string | null;
  mcpAllowedToolsJson?: string | null;
  ownerUserId?: number | null;
  delegationDepth?: number;
  /** #747: mark as a background/system session excluded from the normal session list. */
  isSystem?: boolean;
  /** USO B1 (#1028): explicit session category; omit to derive from scheduledTaskId. */
  category?: import('../models/agent_session').SessionCategory | null;
}): string | null {
  try {
    const repo = new AgentSessionsRepository();
    const session = repo.insert({
      agentKind: opts.agentKind as import('../models/agent_session').AgentKind,
      taskId: null,
      taskTitle: null,
      cwd: opts.cwd,
      name: opts.name,
      projectId: null,
      mcpRole: opts.mcpRole ?? null,
      mcpAllowedToolsJson: opts.mcpAllowedToolsJson ?? null,
      scheduledTaskId: opts.scheduledTaskId ?? null,
      ownerUserId: opts.ownerUserId ?? null,
      delegationDepth: opts.delegationDepth ?? 0,
      // #747: scheduler-spawned and memory runs are background system sessions.
      // isSystem defaults to true when scheduledTaskId is set (all scheduler runs
      // are background; user-facing chat sessions go through the WS gateway).
      // USO B1 (#1028): self_improvement runs also stay is_system=1 so they never
      // surface in the default Chats view (category ALSO gates the scope filter).
      isSystem: opts.isSystem ?? (!!opts.scheduledTaskId || opts.category === 'self_improvement'),
      // USO B1 (#1028): pass explicit category through; the repo derives
      // 'scheduled'/'chat' when this is null.
      category: opts.category ?? undefined,
    });
    return session.id;
  } catch (err) {
    logger.warn(`[AgentRunner] _recordSession failed (non-fatal): ${String(err)}`);
    return null;
  }
}

// ── Teacher escalation (P4-1) ───────────────────────────────────────────────
//
// When a weaker-model run fails (observable status==='error' — this covers both
// an SDK/LLM failure AND the no-progress fast-fail, which already resolves to
// status:'error'), escalate to a stronger "teacher" model, re-run the SAME
// prompt, and on success capture the teacher's approach as a DRAFT skill with
// source='teacher-escalation'. This is the quality multiplier on top of the
// self-improvement loop (P2/P3).
//
// COST NOTE: escalation re-runs a FAILED run on a stronger (pricier) model, so
// it roughly DOUBLES the cost of failed runs. It fires at most once per run
// (recursion-guarded via _isEscalation). Successful runs never escalate.

/** Never auto-escalate from inside a test run. Mirrors skill_extractor.isTestEnv(). */
function isTestEnv(): boolean {
  return process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';
}

/**
 * P4-1: parse env.agentTeacherModel ('provider/modelId') into a model pair.
 * Splits on the FIRST '/', so model ids containing slashes are preserved.
 * Returns undefined when malformed (no '/' or an empty half) so the caller
 * can decline to escalate rather than re-run against a broken model id.
 */
export function resolveTeacherModel(
  raw?: string,
): { providerID: string; modelID: string } | undefined {
  const value = (raw ?? '').trim();
  const slash = value.indexOf('/');
  if (slash <= 0 || slash >= value.length - 1) return undefined;
  const providerID = value.slice(0, slash).trim();
  const modelID = value.slice(slash + 1).trim();
  if (!providerID || !modelID) return undefined;
  return { providerID, modelID };
}

/**
 * P4-1 (PURE — unit-tested directly): should this run be escalated to the
 * teacher model? True only when ALL hold:
 *  • the original result is an observable failure (status === 'error'), AND
 *  • the failure is not a transient capacity rejection, AND
 *  • teacher escalation is enabled, AND
 *  • this run is NOT itself an escalation (recursion guard).
 *
 * `enabled` is injected (defaults to env.agentTeacherEscalationEnabled) so the
 * toggle is testable without a process restart.
 */
export function shouldEscalate(
  result: Pick<AgentRunResult, 'status' | 'errorCode'>,
  opts: Pick<AgentRunOptions, '_isEscalation'>,
  enabled: boolean = env.agentTeacherEscalationEnabled,
): boolean {
  if (!enabled) return false;
  if (opts._isEscalation) return false; // recursion guard — escalate at most once
  if (result.errorCode === 'capacity') return false; // load is not a model-quality failure
  return result.status === 'error';
}

/** Injectable deps for {@link escalateAndCapture} so tests hit no real model/LLM. */
export interface EscalateDeps {
  /** Re-run function (defaults to {@link run}). */
  runFn: (opts: AgentRunOptions) => Promise<AgentRunResult>;
  /** Skill-capture function (defaults to skill_extractor.distillFromSession). */
  distillFn: (sessionId: string, opts?: { source?: string }) => Promise<unknown>;
  /** Teacher model pair (defaults to env.agentTeacherModel parsed). */
  teacherModel?: { providerID: string; modelID: string };
}

/**
 * P4-1 (unit-tested directly with injected deps): re-run `opts` on the teacher
 * model and, on success, capture the teacher's approach as a DRAFT skill.
 *
 * Control flow:
 *  1. Re-run via `runFn` with the SAME opts, model forced to the teacher model
 *     (modelOverride), `_isEscalation: true` (so its own error path can't
 *     escalate again), and the session name suffixed '(teacher escalation)'.
 *  2. If the escalated run is 'done': fire-and-forget `distillFn(sessionId,
 *     { source: 'teacher-escalation' })` (capture is non-fatal — a throwing
 *     distill never rejects this function) and RETURN the successful result.
 *  3. If the escalated run is also 'error': do NOT escalate again (the
 *     _isEscalation guard ensures runFn won't), and return the ORIGINAL error
 *     result (the caller sees the original failure, not the teacher's).
 *
 * NEVER throws into run()'s caller: a runFn rejection falls back to the original
 * result; a distillFn throw/rejection is swallowed.
 */
export async function escalateAndCapture(
  opts: AgentRunOptions,
  originalResult: AgentRunResult,
  deps: EscalateDeps,
): Promise<AgentRunResult> {
  const teacherModel = deps.teacherModel ?? resolveTeacherModel(env.agentTeacherModel);
  if (!teacherModel) {
    logger.warn(
      `[teacher-escalation] no valid teacher model ('${env.agentTeacherModel}') — skipping escalation`,
    );
    return originalResult;
  }

  const fromModel = opts.modelOverride
    ? `${opts.modelOverride.providerID}/${opts.modelOverride.modelID}`
    : (resolveRunModelLabel(opts.agentConfigId ?? opts.agentKind));
  logger.info(
    `[teacher-escalation] escalating ${fromModel} → ${teacherModel.providerID}/${teacherModel.modelID} after error`,
  );

  let escalated: AgentRunResult;
  try {
    escalated = await deps.runFn({
      ...opts,
      _isEscalation: true,
      modelOverride: teacherModel,
      sessionName: `${opts.sessionName ?? 'AgentRunner run'} (teacher escalation)`,
    });
  } catch (err) {
    // Re-run itself blew up — never throw into run()'s caller; keep the original.
    logger.error(`[teacher-escalation] re-run threw (non-fatal): ${String(err)}`);
    return originalResult;
  }

  if (escalated.status === 'done') {
    // Fire-and-forget, non-fatal capture of the teacher's approach as a DRAFT.
    try {
      Promise.resolve(deps.distillFn(escalated.sessionId, { source: 'teacher-escalation' }))
        .then(() => logger.info('[teacher-escalation] skill captured'))
        .catch((e) => logger.warn(`[teacher-escalation] skill capture failed (non-fatal): ${String(e)}`));
    } catch (e) {
      // Guards a distillFn that throws SYNCHRONOUSLY before returning a promise.
      logger.warn(`[teacher-escalation] skill capture failed (non-fatal): ${String(e)}`);
    }
    return escalated;
  }

  // Escalated run also failed — do NOT escalate again (guard ensures it won't).
  logger.warn('[teacher-escalation] teacher run also errored — returning original error');
  return originalResult;
}

/** Best-effort label of the model resolveRunModel() would pick (logging only). */
function resolveRunModelLabel(configId?: string | null): string {
  try {
    const m = resolveRunModel(configId);
    return `${m.providerID}/${m.modelID}`;
  } catch {
    return 'unknown';
  }
}

// ── Main run function ─────────────────────────────────────────────────────────

export async function run(opts: AgentRunOptions): Promise<AgentRunResult> {
  const result = await _runOnce(opts);

  // P4-1: guarded auto-escalation. Under test this NEVER fires automatically
  // (tests drive escalateAndCapture/shouldEscalate explicitly with injected
  // deps). The Postgres path is unaffected — escalation is a local-agent
  // concern and distill no-ops under Postgres anyway.
  if (!isTestEnv() && shouldEscalate(result, opts)) {
    const { distillFromSession } = await import('./skill_extractor');
    return escalateAndCapture(opts, result, {
      runFn: run,
      distillFn: distillFromSession,
    });
  }

  return result;
}

async function _runOnce(opts: AgentRunOptions): Promise<AgentRunResult> {
  const {
    prompt,
    allowedMcpsJson,
    allowedSkillsJson,
    mcpRole,
    cwd,
    taskId,
    outputTarget = 'session',
    agentConfigId,
    agentKind,
    sessionName,
    scheduledTaskId,
    ownerUserId,
    delegationDepth,
    modelOverride,
    taskKind,
    category,
  } = opts;

  // Unique slot key for concurrency tracking
  const slotKey = `run-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  if (!_acquireSlot(slotKey)) {
    const msg = `AgentRunner: concurrency cap (${getMaxConcurrentRuns()}) reached — rejecting run`;
    logger.warn(`[AgentRunner] ${msg}`);
    return {
      sessionId: '',
      result: '',
      status: 'error',
      error: msg,
      errorCode: 'capacity',
    };
  }

  // #738-fix: Resolve the model BEFORE entering the 600s poll so a missing
  // model is a fast fail rather than a silent timeout.
  // agentKind IS the agent_configs id (e.g. 'claude-code') — treat it as the
  // config id so the profile's model is used instead of dropping to MRU/default.
  const effectiveConfigId = agentConfigId ?? agentKind;
  // P4-1: a forced modelOverride (teacher escalation) bypasses resolveRunModel.
  // P1a: resolve model + MCP scope + profile metadata via the shared helper.
  // Pass allowedMcpsJson (from the scheduled-task row) as an override when it
  // was explicitly provided by the caller — this preserves the byte-for-byte
  // behavior of the scheduled path. When it is undefined (ad-hoc / cookbook runs
  // with no explicit scope), the helper derives MCP scope from the profile's own
  // allowed_mcps_json column (new interactive-parity behavior).
  const profileScope = await resolveProfileScope(effectiveConfigId, {
    allowedMcpsJsonOverride: allowedMcpsJson !== undefined ? allowedMcpsJson : undefined,
    // scope-inheritance: a task-level skill allowlist overrides the profile's; undefined inherits.
    allowedSkillsJsonOverride: allowedSkillsJson !== undefined ? allowedSkillsJson : undefined,
  });
  // P4-1: a forced modelOverride (teacher escalation) bypasses the profile model.
  // #844: when a taskKind is supplied, layer budget-aware tiered routing ON TOP
  // of the same precedence — resolveTieredModel() itself honors modelOverride
  // first (never downgraded), then profileScope.modelTierHint / the task-kind
  // policy, narrowed to an authed route and downgraded further only when the
  // target provider is near its usage budget. Omitting taskKind (every
  // pre-#844 caller) leaves this byte-for-byte unchanged: modelOverride ??
  // profileScope.model, no resolveTieredModel call, no extra logging.
  let resolvedModel = modelOverride ?? profileScope.model;
  if (taskKind) {
    try {
      const { resolveTieredModel } = await import('./agent_model_resolver');
      const decision = await resolveTieredModel({
        agentId: effectiveConfigId ?? 'claude-code',
        taskKind,
        explicitTierHint: profileScope.modelTierHint as
          | 'cheap'
          | 'standard'
          | 'frontier'
          | null,
        modelOverride: modelOverride ?? null,
      });
      resolvedModel = decision.route;
    } catch (err) {
      // Non-fatal: tiered routing is a policy layer — a failure here must
      // never block a run. Fall back to the existing precedence.
      logger.warn(`[AgentRunner] resolveTieredModel failed (non-fatal): ${String(err)}`);
    }
  }
  const effectiveSystemPrompt: string | null = profileScope.systemPrompt;
  const effectiveOcAgent: string | null = profileScope.ocAgent;
  // TODO: pass effectiveSystemPrompt to createSession once the SDK supports a
  // per-session system prompt parameter (currently session-level is not exposed).
  // TODO: forward effectiveOcAgent per-turn once there's a profile-level override
  // mechanism (currently only ws_gateway.ts supports per-turn `agent:` overrides).

  // P3-2: retrieve relevant skills and build a TRANSIENT preface. This is
  // prepended to the in-memory prompt ONLY for this send — it is never written
  // to config.systemPrompt, never persisted, and never passed to the agent
  // writer. When the instance-wide toggle is off, no retrieval happens and the
  // prompt is unchanged. uses are incremented post-send (success path only).
  // #1110 — self_improvement runs (distill/score/judge/rewrite) are cheap,
  // tool-less, mechanical background calls that never benefit from retrieved
  // skills or memory; skip the retrieval work entirely (not just its result)
  // to avoid re-paying that cost on every harvest call.
  let effectivePrompt = prompt;
  let injectedSkillIds: string[] = [];
  if (isSkillInjectionEnabled() && category !== 'self_improvement') {
    try {
      // P1b: pass the profile's allowedSkillsJson so only permitted skills are injected.
      const preface = buildSkillsPreface(prompt, { allowedSkillsJson: profileScope.allowedSkillsJson });
      if (preface.text) {
        effectivePrompt = `${preface.text}\n\n${prompt}`;
        injectedSkillIds = preface.skillIds;
        logger.info(
          `[AgentRunner] injected ${injectedSkillIds.length} retrieved skill(s) into prompt preface`,
        );
      }
    } catch (err) {
      // Non-fatal: a retrieval failure must never block the run.
      logger.warn(`[AgentRunner] skill preface build failed (non-fatal): ${String(err)}`);
    }
  }

  // FOLLOW-UP (memory injection): retrieve OWNER-SCOPED relevant memories and
  // prepend a TRANSIENT "## Known context" block. This ADDS to the skills
  // preface (does not replace it) — final layout is:
  //   <memory preface>\n\n<skills preface>\n\n<original prompt>
  // Each preface is independently toggle-guarded so disabling one leaves the
  // other working. Like the skills preface it is in-memory only for this send:
  // never written to config.systemPrompt, never persisted, never passed to the
  // agent writer. FAIL-SAFE: ownerUserId is threaded straight to owner-scoped
  // retrieval; a null/undefined owner retrieves ONLY instance-global memory.
  // #862 — captured here (before rhythmSessionId exists below) and recorded
  // to AgentSessionMemoryProvenanceRepository once the session row is
  // created, so "Memories used in this reply" is available for scheduled/
  // headless runs the same as interactive ws_gateway turns. null when
  // injection was disabled or failed — no provenance is recorded in that case
  // (distinct from an explicit empty-list "0 memories used" turn).
  let memoryProvenance: { memoryIds: string[]; notePaths: (string | null)[] } | null = null;
  if (isMemoryInjectionEnabled() && category !== 'self_improvement') {
    try {
      const memPreface = await buildMemoryPreface(prompt, ownerUserId ?? null);
      if (memPreface.text) {
        effectivePrompt = `${memPreface.text}\n\n${effectivePrompt}`;
        logger.info(
          `[AgentRunner] injected ${memPreface.memoryIds.length} relevant memory item(s) into prompt preface (owner=${ownerUserId ?? 'global'})`,
        );
      }
      memoryProvenance = { memoryIds: memPreface.memoryIds, notePaths: memPreface.notePaths };
    } catch (err) {
      // Non-fatal: a retrieval failure must never block the run.
      logger.warn(`[AgentRunner] memory preface build failed (non-fatal): ${String(err)}`);
    }
  }

  // #738-fix: Record a session row so this run appears in the CHATS list.
  const effectiveAgentKind = agentKind ?? 'claude-code';
  const promptTitle = _titleFromPrompt(prompt);
  const effectiveName = sessionName && !_isSessionNamePlaceholder(sessionName)
    ? sessionName
    : promptTitle ?? sessionName ?? (scheduledTaskId ? 'Scheduled run' : 'AgentRunner run');
  const effectiveCwd = cwd ?? process.cwd();

  const rhythmSessionId = _recordSession({
    name: effectiveName,
    agentKind: effectiveAgentKind,
    cwd: effectiveCwd,
    scheduledTaskId: scheduledTaskId ?? null,
    mcpRole: mcpRole ?? profileScope.mcpRoleConfig?.role ?? null,
    mcpAllowedToolsJson: allowedMcpsJson ?? profileScope.mcpRoleConfig?.allowedToolsJson ?? null,
    ownerUserId: ownerUserId ?? null,
    delegationDepth: delegationDepth ?? 0,
    category: category ?? null,
  });

  // #862 — record "Memories used in this reply" now that the local session
  // row exists. Non-fatal: a recording failure must never block the run.
  if (rhythmSessionId && memoryProvenance) {
    try {
      new AgentSessionMemoryProvenanceRepository().record(
        rhythmSessionId,
        memoryProvenance.memoryIds,
        memoryProvenance.notePaths,
      );
    } catch (err) {
      logger.warn(`[AgentRunner] memory provenance record failed (non-fatal): ${String(err)}`);
    }
  }

  const deadline = Date.now() + getRunTimeoutMs();
  let opencodeSessionId: string | null = null;

  try {
    // ── Build mcpRoleConfig via the shared profile scope helper ──────────────
    // P1a: use the resolved profileScope.mcpRoleConfig directly. For the
    // scheduled path allowedMcpsJson was passed as the override, so behavior
    // is byte-for-byte identical to the previous inline construction. For
    // ad-hoc/cookbook runs the profile's own allowed_mcps_json is now honored.
    // If a role slug was explicitly provided, wrap it as a named config on top
    // of what resolveProfileScope returned (legacy mcpRole path).
    let mcpRoleConfig: import('./agent_profile_scope').McpRoleConfig | undefined =
      profileScope.mcpRoleConfig ?? undefined;

    if (mcpRole && !mcpRoleConfig) {
      // Legacy role-slug path: build a minimal config when profileScope didn't
      // produce one (the slug provides naming context; allowedMcpsJson provides
      // the tools map — keep the original constructor logic for this path).
      if (allowedMcpsJson) {
        mcpRoleConfig = {
          role: mcpRole,
          mcpServers: _parseMcpServersFromJson(allowedMcpsJson),
          allowedToolsJson: allowedMcpsJson,
        };
      }
    }

    // #775/#916 (skill-scope): parse the resolved profile/task skill allowlist
    // so the scheduled session is scoped at create time. null/undefined means
    // unrestricted; a present empty array means deny all skills.
    let skillNames: string[] | undefined = undefined;
    if (profileScope.allowedSkillsJson !== null) {
      skillNames = [];
      try {
        const parsed = JSON.parse(profileScope.allowedSkillsJson);
        if (Array.isArray(parsed)) {
          skillNames = parsed.filter((s): s is string => typeof s === 'string' && s.trim().length > 0);
        }
      } catch {
        logger.error(
          `[AgentRunner] profile=${effectiveConfigId ?? 'profile'}: invalid allowedSkillsJson JSON; denying all skills. offendingValue=`,
          profileScope.allowedSkillsJson,
        );
      }
    }

    // #892 — preflight: a specialist whose required MCP servers aren't
    // authenticated (e.g. worship-planning's all-pco-services toolset with no
    // PCO OAuth configured) previously hung all the way to the createSession +
    // prompt() timeout race below (up to AGENT_RUN_TIMEOUT_MS, 600s default) —
    // the engine can't bring up the backend, so the api_server→engine call
    // eventually dies with a generic UND_ERR_HEADERS_TIMEOUT. Check the live
    // MCP status map for every server this run's role requires and fail fast
    // with a clear, actionable message instead. Fail-OPEN on the status check
    // itself (engine not ready / listMcp() throws) — a preflight-check failure
    // must never block a run that might otherwise succeed.
    if (mcpRoleConfig && opencodeClient.isReady) {
      const requiredServers = Object.keys(mcpRoleConfig.mcpServers);
      if (requiredServers.length > 0) {
        try {
          const statusMap = await _withinRunDeadline(
            opencodeClient.listMcp(),
            deadline,
            'MCP readiness preflight',
          );
          const unauthed = requiredServers.filter(
            (name) => statusMap[name]?.status === 'needs_auth',
          );
          if (unauthed.length > 0) {
            const msg = `AgentRunner: ${unauthed.join(', ')} isn't connected — connect it in Integrations before delegating to this specialist`;
            logger.warn(`[AgentRunner] ${msg}`);
            _markSessionError(rhythmSessionId, msg);
            return {
              sessionId: rhythmSessionId ?? '',
              result: '',
              status: 'error',
              error: msg,
            };
          }
        } catch (err) {
          if (err instanceof AgentRunTimeoutError) throw err;
          logger.warn(`[AgentRunner] #892 MCP readiness preflight failed (non-fatal, proceeding): ${String(err)}`);
        }
      }
    }

    // ── Create session ────────────────────────────────────────────────────────
    // #884: pass the already-resolved provider so createSession can trim the
    // MCP allowlist to Gemini's function-declaration cap when this run is
    // routed to `google` (direct route or a model-fallback route) — a no-op
    // for every other provider.
    const sessionResult = await _withinRunDeadline(
      opencodeClient.createSession(
        effectiveName,
        effectiveCwd,
        mcpRoleConfig,
        skillNames,
        resolvedModel.providerID,
      ),
      deadline,
      'session creation',
    );

    if (!sessionResult?.id) {
      return {
        sessionId: rhythmSessionId ?? '',
        result: '',
        status: 'error',
        error: 'AgentRunner: failed to create opencode session',
      };
    }

    const sessionId = sessionResult.id;
    opencodeSessionId = sessionId;
    if (rhythmSessionId) {
      // #1040 — Route this headless SDK session through the same per-directory
      // event stream as interactive chats. The bridge resolves SDK event ids
      // through this map, so register the mapping before starting the stream.
      opencodeSessionMap.set(rhythmSessionId, sessionId);
      try {
        const sessRepo = new AgentSessionsRepository();
        sessRepo.setSdkSessionId(rhythmSessionId, sessionId);
        // Preserve the explicit starting→working transition as the immediate
        // baseline; subsequent bridge events maintain live status and the
        // completion block below remains authoritative for final idle/error.
        sessRepo.updateStatus(rhythmSessionId, 'working');
        // Every AgentRunner.run() call is headless (see the promptOpts below —
        // permissionMode is unconditionally 'bypassPermissions' because
        // "there's no UI to approve tool perms"). But that value is only ever
        // passed as a per-prompt SDK option; it was never persisted onto this
        // session's own permission_mode column. opencode_stream_bridge.ts's
        // auto-accept gate for permission.asked/permission.updated events
        // reads sessionsRepo.findById(...).permissionMode, NOT the per-prompt
        // option — so it saw the DB default ('default') and forwarded a live
        // approval card to a UI nobody was watching, hanging the run forever
        // on the very first non-allowlisted tool call (e.g. glob). Persist the
        // same mode here so the bridge's gate agrees with the engine's.
        sessRepo.updatePermissionMode(rhythmSessionId, 'bypassPermissions');
      } catch (err) {
        logger.warn(`[AgentRunner] setSdkSessionId failed (non-fatal): ${String(err)}`);
      }
      // #1040 — lazy import: the bridge singleton constructs repositories at
      // module load, which breaks every test that mocks them if imported
      // top-level from this widely-imported module (same pattern as
      // resolveTieredModel above). Await only the (cached) import; the
      // subscription itself stays fire-and-forget and never blocks the run.
      try {
        const { streamBridge } = await import('./opencode_stream_bridge');
        void streamBridge
          .streamSession(rhythmSessionId, sessionId, effectiveCwd)
          .catch((err) =>
            logger.warn(
              `[AgentRunner] stream bridge subscription failed (non-fatal): ${String(err)}`,
            ),
          );
      } catch (err) {
        logger.warn(
          `[AgentRunner] stream bridge import failed (non-fatal): ${String(err)}`,
        );
      }
    }

    // ── Send the prompt SYNCHRONOUSLY and get the full response ───────────────
    // #738-fix (root cause): the runner used promptAsync() — fire-and-forget,
    // whose results only arrive via the opencode SSE /event stream. Before
    // #1040, the WS gateway consumed that stream but a headless runner had NO
    // consumer, so the prompt enqueued but was never driven → 0 messages →
    // timeout. session.prompt() still blocks server-side until the model
    // finishes and RETURNS { info, parts }; the new stream is observability,
    // never completion authority.
    // Pass the resolved model + bypassPermissions (no UI to approve tool perms,
    // else claude/anthropic stalls — ws_gateway.ts #711).
    //
    // #738-fix (root cause #2): do NOT pass `agent: agentKind` here. The Rhythm
    // agentKind ('claude-code' / 'codex') is a MODEL selector — it is fed to
    // resolveRunModel() above — and is NOT an opencode agent name. opencode's
    // registered agents are 'build' (default), 'general', 'coding-agent', etc.
    // Passing an unknown agent makes the opencode server return HTTP 200 with an
    // EMPTY body and NEVER run an LLM turn (0 assistant messages) — the exact
    // silent-success symptom this fix removes. The interactive WS path only
    // sends `agent` for an explicit per-turn override (ws_gateway.ts ~560),
    // otherwise omitting it so opencode uses its default 'build' agent. We mirror
    // that: omit `agent` so the prompt is driven by the default agent.
    // P2: Forward the profile's system_prompt and ocAgent via the per-prompt body.
    // Per docs/ai/decisions/2026-06-24-sdk-per-session-system-prompt.md:
    // SDK 1.14.49 has no per-session system param; use SessionPromptData.body fields.
    // GUARDRAIL (#738): do NOT pass `agentKind` (provider kind) as `agent`.
    // Only the profile's ocAgent (an opencode *mode* e.g. 'build'/'plan') is forwarded.
    // When ocAgent is null, omit the field to preserve the existing #738 behavior.
    // #1039 Cause B — single-source scoping when running AS the profile's own
    // registered agent. agent_profile_sync (#858) backfills oc_agent to the
    // profile id, so for a scheduled/background profile run effectiveOcAgent ===
    // effectiveConfigId — i.e. we pass `agent: <profileId>` and opencode loads
    // that profile's `.md`. That `.md` body IS the profile systemPrompt
    // (opencode_agent_writer writes body = systemPrompt), and opencode layers a
    // per-message `system:` override AFTER the agent prompt (session/llm.ts) — so
    // passing effectiveSystemPrompt here duplicates the profile prompt on top of
    // itself. The `.md` is the single source of the agent's prompt: omit the
    // `system:` override on this path and let the frontmatter/body drive it.
    //   Gated by `!mcpRole` so the self_improvement / mcp-role path (skill-refine,
    // measure, extract, proposal re-runs — all pass mcpRole + assemble scope via
    // mcpRoleConfig, NOT via the profile's own .md) keeps its existing behavior:
    // it still forwards the system override. A genuine built-in ocAgent
    // ('build'/'plan', where ocAgent !== configId) also keeps the override.
    const runningAsOwnAgent =
      !mcpRole && effectiveOcAgent !== null && effectiveOcAgent === effectiveConfigId;
    const promptOpts: Record<string, unknown> = {
      permissionMode: 'bypassPermissions',
      ...(effectiveSystemPrompt !== null && !runningAsOwnAgent
        ? { system: effectiveSystemPrompt }
        : {}),
      ...(effectiveOcAgent !== null ? { agent: effectiveOcAgent } : {}),
    };
    // #1002: opencode sessions are DIRECTORY-SCOPED. The session was created
    // under effectiveCwd (cwd ?? process.cwd()); every post-creation call MUST
    // use the SAME directory or the engine looks in its default instance, finds
    // no session, and yields an empty response — surfacing the bogus
    // "model produced no output" error on the headless/scheduler path (where
    // the raw `cwd` is undefined). Use effectiveCwd for prompt/listMessages/abort.
    const response = await _withinRunDeadline(
      opencodeClient.prompt(sessionId, effectivePrompt, resolvedModel, effectiveCwd, promptOpts),
      deadline,
      'prompt',
    );

    if (!response) {
      logger.error(
        `[AgentRunner] session ${sessionId}: prompt returned no response (model ${resolvedModel.providerID}/${resolvedModel.modelID} may be invalid or the provider unauthenticated)`,
      );
      _markSessionError(
        rhythmSessionId,
        `No response from ${resolvedModel.providerID}/${resolvedModel.modelID} — check the model is valid and the provider is authenticated`,
      );
      return {
        sessionId: rhythmSessionId ?? sessionId,
        result: '',
        status: 'error',
        error:
          'AgentRunner: model produced no output — check the agent profile model (provider/modelId) is valid and the provider is authenticated',
      };
    }

    // Extract assistant text from the returned parts.
    const _extractText = (parts: ReadonlyArray<{ type: string }> | undefined) =>
      (parts ?? [])
        .filter(
          (p): p is import('@opencode-ai/sdk').TextPart => p.type === 'text',
        )
        .map((p) => p.text)
        .join('\n')
        .trim();

    let resultText = _extractText(response.parts);

    // Fallback: session.prompt's returned parts can be empty for agent turns;
    // read the session's final assistant message (same source the interactive
    // transcript uses) and extract its text.
    if (!resultText) {
      try {
        const msgs = await opencodeClient.listMessages(sessionId, effectiveCwd);
        const lastAssistant = msgs
          .filter((m) => m.role === 'assistant')
          .pop();
        resultText = _extractText(
          lastAssistant?.parts as ReadonlyArray<{ type: string }> | undefined,
        );
      } catch (err) {
        logger.warn(`[AgentRunner] listMessages fallback failed: ${String(err)}`);
      }
    }

    // ── Persist to Rhythm's message store + flip status ───────────────────────
    // The stream bridge now persists structured parts live for headless runs,
    // but completion remains authoritative for reliability (#738). Upsert the
    // final assistant response by its SDK message id so this fallback and the
    // bridge converge on one row regardless of which writer arrives first.
    // If the SDK omits a message id, retain the legacy append behavior.
    if (rhythmSessionId) {
      try {
        const msgRepo = new AgentSessionMessagesRepository();
        // #1040 dedupe (input side): the stream bridge also persists the user
        // message (role 'user' → 'input') with its sdk_message_id. Only append
        // the legacy input row when the bridge hasn't already written one for
        // this fresh headless session — otherwise every run shows a doubled
        // prompt. (Headless sessions are one-turn, so any existing input row
        // means the bridge got there first.)
        const hasBridgeInput = msgRepo
          .listBySession(rhythmSessionId, 50)
          .some((m) => m.role === 'input');
        if (!hasBridgeInput) {
          msgRepo.append(rhythmSessionId, 'input', prompt, prompt);
        }
        if (resultText) {
          const sdkMessageId =
            typeof response.info?.id === 'string' ? response.info.id : null;
          if (sdkMessageId) {
            msgRepo.upsertStructured(
              rhythmSessionId,
              sdkMessageId,
              'output',
              JSON.stringify(response.parts ?? []),
              null,
              null,
            );
          } else {
            msgRepo.append(rhythmSessionId, 'output', resultText, resultText);
          }
        }
        const sessRepo = new AgentSessionsRepository();
        sessRepo.updateStatus(rhythmSessionId, 'idle');
        // #904 — background loop "what happened" activity log. Interactive
        // chats get last_preview from the WS stream bridge; a scheduled/
        // headless run bypasses that bridge entirely (see comment above), so
        // without this a background run's session row never carries a
        // preview of its own output.
        if (resultText) {
          sessRepo.updatePreview(
            rhythmSessionId,
            resultText.slice(0, 500),
            new Date().toISOString(),
          );
        }
      } catch (err) {
        logger.warn(`[AgentRunner] persist result failed (non-fatal): ${String(err)}`);
      }
    }

    // ── Output delivery ───────────────────────────────────────────────────────
    if (outputTarget === 'task_notes' && taskId) {
      await _deliverToTaskNotes(taskId, resultText).catch((err) => {
        logger.warn(`[AgentRunner] task_notes delivery failed for task ${taskId}: ${String(err)}`);
      });
    } else if (outputTarget === 'notification') {
      // TODO: POST to notifications path once the endpoint shape is finalised
      logger.info(`[AgentRunner] notification delivery is a no-op (TODO)`);
    }
    // 'session' path: nothing extra to do — result lives in the opencode session

    logger.info(`[AgentRunner] session ${sessionId} completed (outputTarget=${outputTarget})`);

    // P2-2: fire-and-forget background skill extraction on the SUCCESS path only
    // (>= 2 rounds gate is enforced inside queueSkillExtraction). Must NOT be
    // awaited and must not change this return value or its timing.
    if (rhythmSessionId) {
      queueSkillExtraction(rhythmSessionId);
    }

    // #929 / #1109 — schedule (not run) evaluation of any harvested draft that
    // just crossed its use threshold (real `skill`-tool invocations persisted
    // this turn may have pushed one over). #1109: no longer calls
    // evaluateHarvestedDrafts() directly on every turn — scheduleIdleEvaluation
    // coalesces a burst of turns into ONE sweep after the loop goes idle.
    // NEVER awaited; never throws.
    scheduleIdleEvaluation();

    // P3-2: bump `uses` for each injected skill (non-fatal, success path only).
    // This is the only persisted side-effect of injection — the preface text
    // itself is never stored.
    if (injectedSkillIds.length > 0) {
      try {
        const skillsRepo = new AgentSkillsRepository();
        for (const skillId of injectedSkillIds) {
          skillsRepo.incrementUses(skillId);
        }
      } catch (err) {
        logger.warn(`[AgentRunner] incrementUses failed (non-fatal): ${String(err)}`);
      }
    }

    return {
      sessionId: rhythmSessionId ?? sessionId,
      result: resultText,
      status: 'done',
    };
  } catch (err) {
    if (err instanceof AgentRunTimeoutError) {
      if (opencodeSessionId) {
        await opencodeClient.abortSession(opencodeSessionId, effectiveCwd).catch(() => {});
      }
      logger.warn(`[AgentRunner] ${err.message}`);
      _markSessionError(rhythmSessionId, err.message);
      return {
        sessionId: rhythmSessionId ?? opencodeSessionId ?? '',
        result: '',
        status: 'error',
        error: `AgentRunner: ${err.message}`,
      };
    }
    const errMsg = String(err);
    logger.error(`[AgentRunner] unexpected error: ${errMsg}`);
    _markSessionError(rhythmSessionId, errMsg);
    return {
      sessionId: rhythmSessionId ?? '',
      result: '',
      status: 'error',
      error: errMsg,
    };
  } finally {
    _releaseSlot(slotKey);
  }
}

/**
 * Mark a recorded run session as errored (non-fatal best-effort). #904 — an
 * optional message is recorded as the session's last_preview so the
 * background-loop activity log shows WHY a run failed, not just that it did.
 */
function _markSessionError(rhythmSessionId: string | null, message?: string): void {
  if (!rhythmSessionId) return;
  try {
    const repo = new AgentSessionsRepository();
    repo.updateStatus(rhythmSessionId, 'error');
    if (message) {
      repo.updatePreview(rhythmSessionId, message.slice(0, 500), new Date().toISOString());
    }
  } catch {
    /* non-fatal */
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Parse allowedMcpsJson (a per-server tool-allowlist map) into the mcpServers
 * shape expected by createSession's mcpRoleConfig.
 *
 * Input: '{"rhythm":["rhythm_list_tasks"],"github":["github_list_repos"]}'
 * Output: { rhythm: { allowedTools: ['rhythm_list_tasks'] }, github: { allowedTools: [...] } }
 */
function _parseMcpServersFromJson(allowedMcpsJson: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(allowedMcpsJson) as Record<string, unknown>;
    const mcpServers: Record<string, unknown> = {};
    for (const [serverName, tools] of Object.entries(parsed)) {
      if (Array.isArray(tools)) {
        mcpServers[serverName] = { allowedTools: tools };
      } else {
        // Already in expanded form (e.g. { allowedTools: [...] }) — pass through
        mcpServers[serverName] = tools;
      }
    }
    return mcpServers;
  } catch {
    logger.warn(`[AgentRunner] _parseMcpServersFromJson: invalid JSON — ignoring`);
    return {};
  }
}

/**
 * Best-effort PATCH of a Rhythm task's notes field.
 * Uses the production API URL from env (if configured) or falls back to localhost.
 */
async function _deliverToTaskNotes(taskId: string, text: string): Promise<void> {
  const baseUrl = env.prodApiUrl ?? `http://localhost:${env.port}`;
  const authToken = env.prodAuthToken;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

  const resp = await fetch(`${baseUrl}/tasks/${taskId}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ notes: text }),
  });
  if (!resp.ok) {
    throw new Error(`PATCH /tasks/${taskId} returned ${resp.status}`);
  }
}
