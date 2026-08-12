import { broadcast, broadcastSessionUpdated } from './ws_gateway';
import { opencodeClient } from './opencode_engine';
import { opencodeSessionMap } from './opencode_engine';
import { logger } from '../utils/logger';
import {
  registerGeneratedMediaPart,
  withHostedArtifactMetadata,
} from './media_artifact_store';
import { indexResearchSession } from './specialist_research_indexer';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { AgentSessionMessagesRepository } from '../repositories/agent_session_messages_repository';
import { DeniedToolEventsRepository } from '../repositories/denied_tool_events_repository';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { queueSkillExtraction } from './skill_extractor';
import { scheduleIdleEvaluation } from './harvested_skill_evaluator';
import { extractInvokedSkillNamesFromParts, ensureLazyDepsForTurn } from './lazy_deps_turn_hook';
import { isToolAllowed } from './mcp_dispatch_guard';
import { opencodeEventHub } from './opencode_event_hub';
import { classifyCommands, extractBashCommands } from '../security/command_approval';

/**
 * Engine permission ids that are permission SCOPES rather than tool names.
 *
 * `permission.asked` carries its id in `permission`, and the bridge derives
 * `toolName` from it (see the permission.asked handler). These seven are not tools,
 * so they must never be matched against a session's tool allowlist — doing so
 * denies doom-loop detection, plan enter/exit and question prompts on every
 * role-scoped session. Mirrors the defaults in
 * apps/opencode_fork/packages/opencode/src/agent/agent.ts.
 */
const NON_TOOL_PERMISSION_SCOPES = new Set([
  'doom_loop',
  'external_directory',
  'plan_enter',
  'plan_exit',
  'question',
  'repo_clone',
  'repo_overview',
]);
import { resolveApprovalsMode } from '../config/env';
import {
  advanceFallbackCascade,
  clearTurn,
  finalizeErrorStatus,
  noteUserMessage,
  onSessionError,
} from './turn_redispatch';
import type { AgentSession, PermissionMode } from '../models/agent_session';
import { asyncDelegationCompletionService } from './async_delegation_completion_service';

/**
 * How often each active directory stream polls the engine's GET /question to
 * recover a `question.asked` event that was missed on the SSE stream. opencode
 * blocks the `question` tool until a reply arrives, so a missed event would
 * otherwise hang the turn forever with no card to answer from.
 */
const QUESTION_RECOVERY_POLL_MS = 1500;

/**
 * OCU-29 (#1070) — heartbeat watchdog window. The engine emits a synthetic
 * `server.heartbeat` every 10s on every SSE stream; if NOTHING (event or
 * heartbeat) arrives for longer than this, the stream is considered dead —
 * tear it down and resubscribe (which re-runs the recover/reconcile path).
 */
const HEARTBEAT_WATCHDOG_MS = 30_000;
const ENGINE_HEALTH_POLL_MS = 10_000;
const DEFAULT_PERSISTENCE_STALE_MS = 5 * 60_000;

/** Parse a positive-integer env override, falling back when absent/invalid. */
function _positiveTimeoutMs(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * OCU-29 (#1070) — fallback flag. Default is the consolidated single
 * `/global/event` stream. Set RHYTHM_SSE_GLOBAL=0 (or 'false') to revert to the
 * legacy per-directory `/event` subscriptions for one release while the global
 * path bakes. Read fresh so a test can flip it without a process restart.
 */
function useGlobalStream(): boolean {
  const raw = (process.env.RHYTHM_SSE_GLOBAL ?? '').trim().toLowerCase();
  return !(raw === '0' || raw === 'false');
}

/**
 * Tools implemented by the embedded OpenCode engine. These are governed by
 * OpenCode's own agent permission policy; `skill` is additionally constrained
 * by the session skill allowlist. The MCP dispatch guard must only gate MCP
 * tools, otherwise a role scoped to (for example) `rhythm` falsely rejects
 * native calls such as `skill` and `read`.
 *
 * Keep this list aligned with apps/opencode_fork/.../tool/registry.ts — plus
 * `image_generation` (#1094), which is engine-native but NOT in the registry:
 * it is a provider-executed tool injected in session/prompt.ts (the registry
 * only holds tools with a local `execute`). It is still governed by OpenCode's
 * agent permission policy — the per-profile `permission.image_generation`
 * grant — so this guard must not gate it. Omitting it made a role-scoped
 * session reject every call with "not permitted for this agent's role", which
 * is indistinguishable from the profile lacking the grant.
 */
const OPENCODE_NATIVE_TOOLS = new Set([
  'invalid',
  'bash',
  'read',
  'glob',
  'grep',
  'edit',
  'write',
  'task',
  'webfetch',
  'todowrite',
  'websearch',
  'repo_clone',
  'repo_overview',
  'skill',
  'apply_patch',
  'question',
  'lsp',
  'plan_exit',
  'image_generation',
]);

/**
 * Bridges Opencode SSE events to the existing WebSocket gateway.
 *
 * The bridge subscribes to the Opencode event stream once (on first session)
 * and relays events to the WS gateway in the format the Flutter client expects.
 *
 * Real Opencode event types (from the SDK's SSE stream → WS messages):
 *   message.part.updated  → output       { id, data }        (text delta)
 *   message.updated       → output.flush { id, parts }       (final message)
 *   session.status        → session.status { id, working }   (busy/idle)
 *   session.idle          → session.status { id, working: false }
 *   session.error         → error         { id, message }
 *   file.edited           → event         { type, file }
 *
 * Session ID routing: Opencode events carry `properties.sessionID` (SDK session ID).
 * The bridge uses opencodeSessionMap to look up the local session ID for each event.
 */
type DirectoryStream = {
  eventStream: AsyncIterable<import('@opencode-ai/sdk').RhythmEvent>;
  abort: AbortController;
  // Recovery poll for questions whose `question.asked` event was missed on the
  // SSE stream (race with session mapping, child/subagent session, or the
  // engine dropping the event). Mirrors opencode's own CLI transport, which
  // polls `question.list` to recover missed questions. See
  // recoverPendingQuestions().
  questionPoll?: ReturnType<typeof setInterval>;
};

/**
 * Matches the Anthropic 400 raised when a `tool_use` block has no matching
 * `tool_result` immediately after it (or vice versa) — see issue #913. This is
 * the concrete trigger that used to be misclassified as a generic API error
 * and fed an uncapped compact -> continue -> compact loop.
 */
const TOOL_PAIRING_ERROR_PATTERN = /tool_use.*ids were found without.*tool_result|unexpected tool_use_id/i;

/**
 * Best-effort message extraction from the opencode session.error payload.
 * The SDK wraps API errors in {name, data: {message, ...}} or sometimes
 * delivers nested AI SDK errors. We surface the most useful string we can
 * find so the UI shows something readable like "Key limit exceeded" instead
 * of "[object Object]".
 */
function extractErrorMessage(errorInfo: unknown): string {
  if (!errorInfo) return 'Unknown error';
  if (typeof errorInfo === 'string') return errorInfo;
  if (typeof errorInfo !== 'object') return String(errorInfo);
  const obj = errorInfo as Record<string, unknown>;
  const data = obj.data as Record<string, unknown> | undefined;
  // Try data.message first (most common shape).
  if (typeof data?.message === 'string') return data.message;
  // Top-level message.
  if (typeof obj.message === 'string') return obj.message;
  // AI SDK upstream: data.responseBody is JSON with {error: {message, code}}.
  if (typeof data?.responseBody === 'string') {
    try {
      const parsed = JSON.parse(data.responseBody) as Record<string, unknown>;
      const err = parsed.error as Record<string, unknown> | undefined;
      if (typeof err?.message === 'string') {
        return data.responseBody.length > 200
          ? err.message
          : `${err.message} (HTTP ${err.code ?? data.statusCode ?? '?'})`;
      }
    } catch (_) {
      /* fall through */
    }
  }
  // AI SDK upstream: data.responseBody object form.
  const responseBody = data?.responseBody as Record<string, unknown> | undefined;
  const innerError = responseBody?.error as Record<string, unknown> | undefined;
  if (typeof innerError?.message === 'string') return innerError.message;
  // Errors as arrays (Zod-style).
  const errArr = data?.error as Array<{ message?: string }> | undefined;
  if (Array.isArray(errArr) && errArr[0]?.message) return errArr[0].message;
  // Last resort: stringify (capped).
  try {
    const j = JSON.stringify(errorInfo);
    return j.length > 300 ? j.slice(0, 300) + '…' : j;
  } catch {
    return String(errorInfo);
  }
}

/** Shape of a pending permission stored in-memory. */
export interface PendingPermission {
  permissionId: string;
  toolName: string;
  args: Record<string, unknown>;
  summary: string;
  directory?: string;
  patterns?: string[];
  title?: string;
  createdAt?: string;
  /** SDK session ID (needed to call respondPermission). */
  sdkSessionId: string;
}

/**
 * Shape of a pending `question` (AskUserQuestion) tool call stored in-memory.
 *
 * opencode answers questions via a dedicated Question API keyed by `requestId`
 * (the `que_…` id from the `question.asked` event), but the Flutter client only
 * knows the tool `callId` it rendered the card from. We store both so the
 * controller can resolve callId → requestId when the user answers, without the
 * `que_…` id ever needing to leave the server.
 */
export interface PendingQuestion {
  /** opencode QuestionID (the `que_…` id) — needed to POST /question/{id}/reply. */
  requestId: string;
  /** Tool callID (`toolu_…`/`chatcmpl-tool-…`) — what the rendered card carries. */
  callId: string;
  /** SDK session ID. */
  sdkSessionId: string;
  /** The question array (mirrors the tool input) for resume/fallback rendering. */
  questions: unknown[];
}

export class OpencodeStreamBridge {
  // One SSE subscription per directory, because opencode's /event endpoint
  // filters by ?directory= — sessions whose cwd is outside the subscribed
  // directory never produce events on that stream. The same process may
  // host sessions across different cwds, so we track multiple streams.
  private streamsByDirectory = new Map<string, DirectoryStream>();
  // OCU-29 (#1070) — the single consolidated /global/event subscription (when
  // RHYTHM_SSE_GLOBAL is on). Null until the first session starts it.
  private globalStream: {
    abort: () => void;
    watchdog: ReturnType<typeof setInterval>;
  } | null = null;
  /** Epoch ms of the last frame (event OR heartbeat) seen on the global stream. */
  private lastGlobalActivity = 0;
  /** Guards against overlapping resubscribes from the watchdog. */
  private globalResubscribing = false;
  private engineHealthCheckInFlight = false;
  private engineIdentityKey: string | null = null;
  private persistenceBaselineAt = Date.now();
  private sessionsRepo = new AgentSessionsRepository();
  private messagesRepo = new AgentSessionMessagesRepository();
  // #818 — best-effort deny-path telemetry sink; see isToolAllowedForSession.
  private deniedToolEventsRepo = new DeniedToolEventsRepository();
  // #818 follow-up — used only to validate profile-attribution candidates on
  // the deny branch (never on the allow path).
  private agentConfigsRepo = new AgentConfigsRepository();

  /** True only while the bridge has a current subscription receiving frames. */
  get isLive(): boolean {
    if (useGlobalStream()) {
      return this.globalStream !== null &&
        Date.now() - this.lastGlobalActivity <= HEARTBEAT_WATCHDOG_MS;
    }
    return this.streamsByDirectory.size > 0;
  }

  // Accumulate assistant text deltas keyed by local session id. The SDK
  // streams text via `message.part.delta` events; the message body itself
  // arrives empty. We append on session.idle (end of turn) to keep the
  // agent_session_messages history populated.
  private pendingText = new Map<string, string>();

  // OPC-M1-4: Sessions that have been explicitly stopped (via DELETE or
  // close). Events arriving for a stopped session are silently dropped —
  // no WS broadcast, no DB write — so the shared SSE stream can stay alive
  // without producing ghost events for dead local IDs.
  //
  // Note: the old `erroredSessions` Set (which used a 5s setTimeout to
  // auto-clear) has been removed. Error state is now persisted on the DB
  // row (status='error', status_message). We detect "already errored" by
  // reading the DB row status, which survives bridge restarts and never
  // resets on a timer.
  private stoppedSessions = new Set<string>();

  // C2 (2026-08-03 config-doctor track C, daily-dev-summary abort): `glob`
  // has no timeout of its own in the engine, so a hung call (pathological
  // search root, symlink loop, network volume) silently consumes the ENTIRE
  // 600s run inactivity window before the run gets aborted — the postmortem
  // symptom looks like a generic stall with no clue it was glob. Track one
  // pending watchdog per local session; armed when we auto-accept a `glob`
  // permission, cleared by ANY subsequent event for that session (any event
  // is observable progress — the tool finished or a new one started). If
  // nothing happens before the bound fires, force-abort just that session
  // with a diagnostic naming the tool, instead of waiting out the full
  // inactivity window.
  private globWatchdogs = new Map<string, ReturnType<typeof setTimeout>>();

  // In-memory accumulator for message.part.delta events, keyed by
  // `${sdkMessageId}:${partId}`. Deltas are written-through to the DB via
  // applyPartDelta immediately (so a bridge restart loses at most in-flight
  // deltas). This accumulator is only used to assemble the full text for
  // the legacy transcript.append broadcast on session.idle.
  //
  // Flush points: next message.part.updated for the same part (bridge
  // receives the authoritative full-text version — accumulator discarded),
  // message.updated for the same message, or session.idle (turn boundary).
  private pendingPartDeltas = new Map<string, { sdkMessageId: string; partId: string; text: string }>();

  // In-memory map of pending permissions. Key = `${localSessionId}:${permissionId}`.
  // Cleared when the user (or auto-logic) resolves the permission.
  private pendingPermissions = new Map<string, PendingPermission>();
  private repliedPermissions = new Set<string>();

  /** Return the pending permission for a session+permissionId, or undefined. */
  getPendingPermission(localSessionId: string, permissionId: string): PendingPermission | undefined {
    return this.pendingPermissions.get(`${localSessionId}:${permissionId}`);
  }

  /** Remove a pending permission after it is resolved. */
  clearPendingPermission(localSessionId: string, permissionId: string): void {
    this.pendingPermissions.delete(`${localSessionId}:${permissionId}`);
  }

  /** Broadcast the canonical reply frame once and retire the pending ask. */
  markPermissionReplied(localSessionId: string, permissionId: string): void {
    const key = `${localSessionId}:${permissionId}`;
    if (this.repliedPermissions.has(key)) return;
    const pending = this.pendingPermissions.get(key);
    this.pendingPermissions.delete(key);
    this.repliedPermissions.add(key);
    const directory = pending?.directory ?? this.sessionsRepo.findById(localSessionId)?.cwd ?? '';
    broadcast({
      v: 1,
      type: 'permission.replied',
      sessionId: localSessionId,
      permissionID: permissionId,
      directory,
      tool: pending?.toolName ?? '',
      patterns: pending?.patterns ?? [],
      title: pending?.title ?? pending?.summary ?? '',
      createdAt: pending?.createdAt ?? new Date().toISOString(),
    });
  }

  /**
   * Register a pending permission and broadcast the `permission.asked` card
   * frame (OCU-03 #1044). Idempotent: if a permission with this `permissionId`
   * is already tracked for the session, nothing is broadcast and `false` is
   * returned. Shared by the live `permission.updated` ask path and the
   * `GET /permission` recovery poll so a permission surfaced by either path
   * never double-broadcasts (dedup guarantee for the no-duplicate-cards AC).
   */
  private registerPermission(
    localSessionId: string,
    entry: PendingPermission,
  ): boolean {
    if (this.stoppedSessions.has(localSessionId)) return false;
    const key = `${localSessionId}:${entry.permissionId}`;
    if (this.pendingPermissions.has(key)) return false;
    const normalized: PendingPermission = {
      ...entry,
      directory: entry.directory ?? this.sessionsRepo.findById(localSessionId)?.cwd ?? '',
      patterns: entry.patterns ?? [],
      title: entry.title ?? entry.summary,
      createdAt: entry.createdAt ?? new Date().toISOString(),
    };
    this.pendingPermissions.set(key, normalized);
    broadcast({
      v: 1,
      type: 'permission.asked',
      sessionId: localSessionId,
      permissionID: normalized.permissionId,
      directory: normalized.directory,
      tool: normalized.toolName,
      patterns: normalized.patterns,
      title: normalized.title,
      createdAt: normalized.createdAt,
    });
    return true;
  }

  /** Per-call `glob` timeout (ms). Deliberately much shorter than the 600s
   * default inactivity window — this exists specifically to fail fast on a
   * single hung tool call, not to replace the run-level deadline. Read per
   * call (not baked in at module load) so tests can override via env. */
  private globToolTimeoutMs(): number {
    return _positiveTimeoutMs(process.env.AGENT_GLOB_TOOL_TIMEOUT_MS, 20_000);
  }

  /** Any event for this session is progress — cancel a pending glob watchdog. */
  private clearGlobWatchdog(localSessionId: string): void {
    const timer = this.globWatchdogs.get(localSessionId);
    if (timer) {
      clearTimeout(timer);
      this.globWatchdogs.delete(localSessionId);
    }
  }

  /**
   * Arm a bounded watchdog right after auto-accepting a `glob` permission.
   * If no further event for this session arrives before the timeout, force
   * an abort of just this session with a diagnostic naming `glob` — instead
   * of the caller silently burning the full run inactivity window.
   */
  private armGlobWatchdog(
    localSessionId: string,
    sdkSessionId: string,
    directory: string | undefined,
  ): void {
    this.clearGlobWatchdog(localSessionId);
    const timeoutMs = this.globToolTimeoutMs();
    const timer = setTimeout(() => {
      this.globWatchdogs.delete(localSessionId);
      const message = `glob call exceeded ${timeoutMs}ms with no observed progress — aborted to avoid consuming the full run inactivity window`;
      logger.warn(`[OpencodeStreamBridge] ${message} (session=${localSessionId})`);
      void opencodeClient.abortSession(sdkSessionId, directory).catch((err) => {
        logger.warn(`[OpencodeStreamBridge] glob watchdog abortSession failed (non-fatal): ${String(err)}`);
      });
      try {
        this.sessionsRepo.updateStatus(localSessionId, 'error');
        this.sessionsRepo.updatePreview(localSessionId, message.slice(0, 500), new Date().toISOString());
      } catch (err) {
        logger.warn(`[OpencodeStreamBridge] glob watchdog status update failed (non-fatal): ${String(err)}`);
      }
      broadcast({
        v: 1,
        type: 'error',
        id: localSessionId,
        sessionId: localSessionId,
        message,
      });
    }, timeoutMs);
    this.globWatchdogs.set(localSessionId, timer);
  }

  /**
   * Recover permission requests whose `permission.updated` event never reached
   * us on the SSE stream (api_server/engine restart while a permission ask was
   * pending). opencode keeps the tool blocked until the permission is answered,
   * so a missed ask orphans the turn with no card. We poll GET /permission
   * (scoped to a directory), reverse-map each pending permission's SDK session
   * id to a local session, and surface any we are not already tracking.
   *
   * Idempotent and safe to call repeatedly; only newly-seen permissions
   * broadcast (registerPermission dedups against the same requestID delivered
   * by the live stream).
   */
  async recoverPendingPermissions(directory: string): Promise<void> {
    let pending: Array<{
      id: string;
      sessionID: string;
      permission?: string;
      patterns?: string[];
      title?: string;
      metadata?: Record<string, unknown>;
      tool?: { callID?: string };
    }>;
    try {
      pending = await opencodeClient.listPermissions(directory);
    } catch {
      return;
    }
    if (!Array.isArray(pending) || pending.length === 0) return;

    for (const p of pending) {
      if (!p?.id || !p.sessionID) continue;
      let localSessionId: string | undefined;
      for (const [localId, sdkId] of opencodeSessionMap.entries()) {
        if (sdkId === p.sessionID) {
          localSessionId = localId;
          break;
        }
      }
      if (!localSessionId) continue;
      const toolName = p.permission ?? '';
      this.registerPermission(localSessionId, {
        permissionId: p.id,
        toolName,
        args: (p.metadata as Record<string, unknown>) ?? {},
        summary: toolName,
        sdkSessionId: p.sessionID,
        directory,
        patterns: Array.isArray(p.patterns) ? p.patterns : [],
        title: typeof p.title === 'string' ? p.title : toolName,
      });
    }
  }

  // In-memory map of pending questions. Key = `${localSessionId}:${requestId}`.
  // Cleared when opencode emits question.replied/rejected (or on explicit reply).
  private pendingQuestions = new Map<string, PendingQuestion>();

  /** Return the pending question for a session+requestId, or undefined. */
  getPendingQuestion(
    localSessionId: string,
    requestId: string,
  ): PendingQuestion | undefined {
    return this.pendingQuestions.get(`${localSessionId}:${requestId}`);
  }

  /**
   * Resolve a pending question by the tool callId the Flutter card carries.
   * Returns the pending entry (with its `requestId`) or undefined.
   */
  getPendingQuestionByCallId(
    localSessionId: string,
    callId: string,
  ): PendingQuestion | undefined {
    const prefix = `${localSessionId}:`;
    for (const [key, q] of this.pendingQuestions) {
      if (key.startsWith(prefix) && q.callId === callId) return q;
    }
    return undefined;
  }

  /** Remove a pending question after it is resolved. */
  clearPendingQuestion(localSessionId: string, requestId: string): void {
    this.pendingQuestions.delete(`${localSessionId}:${requestId}`);
  }

  /**
   * Register a pending question and broadcast the `question.asked` card frame.
   * Idempotent: if a question with this `requestId` is already tracked for the
   * session, nothing is broadcast and `false` is returned. Shared by the live
   * `question.asked` SSE handler and the `question.list` recovery poll so a
   * question surfaced by either path never double-broadcasts.
   */
  private registerQuestion(
    localSessionId: string,
    entry: PendingQuestion,
  ): boolean {
    if (this.stoppedSessions.has(localSessionId)) return false;
    const key = `${localSessionId}:${entry.requestId}`;
    if (this.pendingQuestions.has(key)) return false;
    this.pendingQuestions.set(key, entry);
    broadcast({
      v: 1,
      type: 'question.asked',
      sessionId: localSessionId,
      requestId: entry.requestId,
      callId: entry.callId,
      questions: entry.questions,
    });
    return true;
  }

  /**
   * Recover questions whose `question.asked` event never reached us on the SSE
   * stream. opencode keeps the `question` tool blocked until
   * POST /question/{id}/reply arrives, so a missed `question.asked` hangs the
   * turn forever with no card to answer from. We poll the engine's
   * GET /question (scoped to a directory), reverse-map each pending question's
   * SDK session id to a local session, and surface any we are not already
   * tracking — mirroring opencode's own CLI transport recovery.
   *
   * Idempotent and safe to call repeatedly; only newly-seen questions broadcast.
   */
  async recoverPendingQuestions(directory: string): Promise<void> {
    let pending: Array<{
      id: string;
      sessionID: string;
      questions?: unknown[];
      tool?: { callID?: string };
    }>;
    try {
      pending = await opencodeClient.listQuestions(directory);
    } catch {
      return;
    }
    if (!Array.isArray(pending) || pending.length === 0) return;

    for (const q of pending) {
      if (!q?.id || !q.sessionID) continue;
      // Reverse-map the SDK session id to a local session id.
      let localSessionId: string | undefined;
      for (const [localId, sdkId] of opencodeSessionMap.entries()) {
        if (sdkId === q.sessionID) {
          localSessionId = localId;
          break;
        }
      }
      if (!localSessionId) continue;
      this.registerQuestion(localSessionId, {
        requestId: q.id,
        callId: q.tool?.callID ?? '',
        sdkSessionId: q.sessionID,
        questions: Array.isArray(q.questions) ? q.questions : [],
      });
    }
  }

  /**
   * OCU-04 (#1045) — reconcile locally-persisted session status against the
   * engine's authoritative GET /session/status map on engine ready / stream
   * (re)subscribe. Session status is otherwise tracked only from live events;
   * a missed event (engine restart, api_server restart, stream gap) leaves a
   * row stuck 'working'/'starting' forever.
   *
   * For every local row still in 'working'/'starting': if the engine reports
   * it idle (status.type !== 'busy') OR the engine doesn't know it at all
   * (absent from the map — the engine treats unknown sessions as idle), correct
   * the row to 'idle' and broadcast the corrected status.
   *
   * Error-precedence rule (shared with the live status/idle handlers): rows in
   * status='error' are NEVER clobbered — listActive() already excludes them, so
   * this is naturally satisfied, but the guard is kept explicit for safety.
   *
   * Idempotent and non-fatal: any per-row failure is logged and skipped; a
   * row the engine reports busy is left untouched.
   */
  async reconcileSessionStatuses(directory?: string): Promise<void> {
    let statusMap: Record<string, { type: string }>;
    try {
      statusMap = await opencodeClient.getSessionStatuses(directory);
    } catch {
      return;
    }
    let active: AgentSession[];
    try {
      active = this.sessionsRepo.listActive();
    } catch (err) {
      logger.error('[OpencodeStreamBridge] reconcileSessionStatuses: listActive failed:', err);
      return;
    }
    for (const session of active) {
      // Error-precedence: listActive() only returns starting/working/idle rows,
      // so an error row is never in this set and is never clobbered (#1045 AC).
      if (session.status !== 'working' && session.status !== 'starting') continue;
      if (this.stoppedSessions.has(session.id)) continue;
      const sdkId = session.sdkSessionId;
      const engineStatus = sdkId ? statusMap[sdkId] : undefined;
      // Busy engine-side → leave as-is. Idle OR unknown → correct to idle.
      if (engineStatus && engineStatus.type === 'busy') continue;
      try {
        this.sessionsRepo.updateStatus(session.id, 'idle');
        broadcast({ v: 1, type: 'session.status', id: session.id, working: false });
        const updated = this.sessionsRepo.findById(session.id);
        if (updated) broadcastSessionUpdated(updated);
      } catch (err) {
        logger.error(
          `[OpencodeStreamBridge] reconcileSessionStatuses: failed to correct ${session.id}:`,
          err,
        );
      }
    }
  }

  /**
   * Start streaming events for a given local session.
   * Subscribes (idempotently) to the opencode /event SSE for the session's
   * cwd. Multiple sessions in the same directory share a single subscriber.
   */
  async streamSession(
    localSessionId: string,
    _opencodeSessionId: string,
    cwd: string,
  ): Promise<void> {
    const directory = cwd && cwd.length > 0 ? cwd : '/';
    logger.info(
      `[OpencodeStreamBridge] streamSession entry session=${localSessionId} sdkSession=${_opencodeSessionId} directory=${directory}`,
    );

    // OCU-29 (#1070) — consolidated single-stream mode: one /global/event
    // subscription spans every directory, so per-session/per-directory
    // subscribes collapse into starting (once) the global stream. Only take
    // this path when the engine wrapper actually exposes the global subscribe
    // (an older engine binary — or a partial test double — that lacks it falls
    // back to the legacy per-directory subscription below).
    if (useGlobalStream() && typeof opencodeClient.subscribeToGlobalEvents === 'function') {
      await this.ensureGlobalStream();
      return;
    }

    if (this.streamsByDirectory.has(directory)) return;

    try {
      const events = await opencodeClient.subscribeToEvents(directory);
      if (!events) {
        logger.error(
          `[OpencodeStreamBridge] No event stream available for directory=${directory}`,
        );
        return;
      }
      const abort = new AbortController();
      // Recovery poll: catch any `question.asked` the SSE stream missed so the
      // ask-question tool can never hang for want of a card. Cheap localhost
      // GET; only newly-seen questions broadcast (registerQuestion is
      // idempotent). Cleared when the stream ends or the session stops.
      const questionPoll = setInterval(() => {
        void this.recoverPendingQuestions(directory);
        // OCU-03 (#1044) — same recovery for orphaned permission asks.
        void this.recoverPendingPermissions(directory);
      }, QUESTION_RECOVERY_POLL_MS);
      if (typeof questionPoll.unref === 'function') questionPoll.unref();
      this.streamsByDirectory.set(directory, {
        eventStream: events.stream,
        abort,
        questionPoll,
      });
      // Fire-and-forget listener loop. Failures inside the loop unset the
      // entry so a subsequent session in the same directory can re-subscribe.
      this._listen(directory).catch((err) =>
        logger.error('[OpencodeStreamBridge] listener crashed:', err),
      );
      // OCU-03 (#1044) — immediate rehydration on (re)connect: surface any
      // permission/question that was already pending before this subscribe
      // (api_server restart mid-ask) without waiting a full poll cycle. Both
      // are idempotent, so a card the live stream also redelivers is deduped.
      void this.recoverPendingQuestions(directory);
      void this.recoverPendingPermissions(directory);
      // OCU-04 (#1045) — reconcile any row left stuck 'working'/'starting' by a
      // missed event before this (re)subscribe, using the engine's status map.
      void this.reconcileSessionStatuses(directory);
      logger.info(
        `[OpencodeStreamBridge] Subscribed to events for directory=${directory} (session=${localSessionId})`,
      );
    } catch (err) {
      logger.error(
        `[OpencodeStreamBridge] Failed to subscribe to ${directory}:`,
        err,
      );
    }
  }

  /**
   * OCU-29 (#1070) — start (idempotently) the single consolidated
   * /global/event subscription plus its heartbeat watchdog. Safe to call on
   * every session start; a no-op once the stream is live.
   */
  async ensureGlobalStream(): Promise<void> {
    if (!useGlobalStream()) return;
    if (this.globalStream) return;
    let sub: Awaited<ReturnType<typeof opencodeClient.subscribeToGlobalEvents>>;
    try {
      sub = await opencodeClient.subscribeToGlobalEvents();
    } catch (err) {
      logger.error('[OpencodeStreamBridge] ensureGlobalStream subscribe threw:', err);
      return;
    }
    if (!sub) {
      logger.error('[OpencodeStreamBridge] ensureGlobalStream: no global stream available');
      return;
    }
    this.lastGlobalActivity = Date.now();
    // Watchdog: if no frame (incl. the engine's 10s heartbeat) arrives within
    // the window, the stream is dead — resubscribe. unref so it never keeps the
    // process alive.
    const watchdog = setInterval(() => {
      if (Date.now() - this.lastGlobalActivity > HEARTBEAT_WATCHDOG_MS) {
        logger.warn(
          '[OpencodeStreamBridge] global stream watchdog fired (no activity > %sms) — resubscribing',
          HEARTBEAT_WATCHDOG_MS,
        );
        void this.resubscribeGlobalStream();
      }
      void this.checkEngineHealthNow();
    }, ENGINE_HEALTH_POLL_MS);
    if (typeof watchdog.unref === 'function') watchdog.unref();
    this.globalStream = { abort: sub.abort, watchdog };
    // #1379 Phase 2 — the consolidated stream is now also the mobile fan-out
    // source. Marking it live is what lets MobileSseProxy stop dialing the
    // engine per device; the flag deliberately stays set across a watchdog
    // resubscribe so a phone rides out an engine restart on a quiet stream
    // instead of falling back to hammering a dead engine.
    opencodeEventHub.setLive(true);
    this._listenGlobal(sub.stream).catch((err) =>
      logger.error('[OpencodeStreamBridge] global listener crashed:', err),
    );
    logger.info('[OpencodeStreamBridge] subscribed to consolidated /global/event stream');
  }

  private async _listenGlobal(
    stream: AsyncIterable<import('@opencode-ai/sdk').RhythmEvent & { __directory?: string }>,
  ): Promise<void> {
    try {
      for await (const event of stream) {
        this.lastGlobalActivity = Date.now();
        // server.heartbeat / server.connected are liveness-only — swallow them
        // (they carry no session and would otherwise emit a generic `event`).
        // The SDK Event union doesn't declare these synthetic types, so compare
        // via a widened view.
        const evType = (event as { type: string }).type;
        if (evType === 'server.heartbeat' || evType === 'server.connected') {
          // #1379 Phase 2 — mobile subscribers DO need these: they are the only
          // traffic on an idle stream, and the phone treats any envelope as
          // proof of liveness before it stands its polling fallback down.
          this._publishToHub(event);
          continue;
        }
        this._relayEvent(event);
        // Published after the relay so every hub subscriber sees a frame the
        // mirror has already persisted — the same ordering guarantee the
        // desktop `broadcast()` path has.
        this._publishToHub(event);
      }
    } catch (err) {
      logger.error('[OpencodeStreamBridge] global stream error:', err);
    } finally {
      // Stream ended on its own — trigger a resubscribe so a transient drop
      // self-heals (unless we are shutting down / already resubscribing).
      if (this.globalStream && !this.globalResubscribing) {
        void this.resubscribeGlobalStream();
      }
    }
  }

  /**
   * OCU-29 (#1070) — tear down the current global stream and start a fresh one,
   * then re-run the recover/reconcile path (OCU-03/#1044 + OCU-04/#1045) so any
   * event missed during the gap is recovered. Guarded against overlap.
   */
  async resubscribeGlobalStream(): Promise<void> {
    if (this.globalResubscribing) return;
    this.globalResubscribing = true;
    try {
      if (this.globalStream) {
        try {
          this.globalStream.abort();
        } catch {
          /* best-effort */
        }
        clearInterval(this.globalStream.watchdog);
        this.globalStream = null;
      }
      await this.ensureGlobalStream();
      // Soft dependency on OCU-03/OCU-04 recovery: reconcile stuck statuses and
      // recover orphaned permission/question asks against every active dir.
      void this.reconcileSessionStatuses();
      for (const dir of this.activeDirectories()) {
        void this.recoverPendingQuestions(dir);
        void this.recoverPendingPermissions(dir);
      }
    } finally {
      this.globalResubscribing = false;
    }
  }

  /**
   * Poll engine identity and persistence progress.
   *
   * Public so deterministic tests and diagnostics can run the same watchdog
   * check without waiting for the interval. Calls are overlap-guarded because
   * `/global/health`, status reconciliation, and recovery all share one local
   * engine process.
   */
  async checkEngineHealthNow(): Promise<void> {
    if (this.engineHealthCheckInFlight) return;
    this.engineHealthCheckInFlight = true;
    try {
      if (typeof opencodeClient.getEngineIdentity === 'function') {
        const identity = await opencodeClient.getEngineIdentity();
        if (identity) {
          const nextKey = `${identity.pid}:${identity.bootId}`;
          const previousKey = this.engineIdentityKey;
          this.engineIdentityKey = nextKey;
          if (previousKey && previousKey !== nextKey) {
            logger.error(
              `[OpencodeStreamBridge] ENGINE IDENTITY CHANGED (${previousKey} -> ${nextKey}) — reattaching bridge and rerunning recovery`,
            );
            await this.reattachAndRecover();
            return;
          }
        }
      }

      const statuses = await opencodeClient.getSessionStatuses();
      const engineHasActiveSessions = Object.values(statuses).some(
        (status) => status.type === 'busy' || status.type === 'working' || status.type === 'starting',
      );
      if (!engineHasActiveSessions) {
        this.persistenceBaselineAt = Date.now();
        return;
      }

      const latestPersistedAt = this.messagesRepo.latestPersistedAt();
      const lastProgressAt = Math.max(
        latestPersistedAt ?? 0,
        this.persistenceBaselineAt,
      );
      const staleMs = _positiveTimeoutMs(
        process.env.RHYTHM_BRIDGE_PERSISTENCE_STALE_MS,
        DEFAULT_PERSISTENCE_STALE_MS,
      );
      if (Date.now() - lastProgressAt > staleMs) {
        logger.error(
          `[OpencodeStreamBridge] STALE BRIDGE: engine has active sessions but api_server persisted no messages for > ${staleMs}ms — reattaching`,
        );
        this.persistenceBaselineAt = Date.now();
        await this.reattachAndRecover();
      }
    } catch (err) {
      logger.error('[OpencodeStreamBridge] engine health watchdog failed:', err);
    } finally {
      this.engineHealthCheckInFlight = false;
    }
  }

  private async reattachAndRecover(): Promise<void> {
    await this.resubscribeGlobalStream();
    try {
      await asyncDelegationCompletionService.recoverAfterRestart();
    } catch (err) {
      logger.error('[OpencodeStreamBridge] post-reattach async recovery failed:', err);
    }
  }

  /** Distinct cwds of currently-active sessions (for recovery scoping). */
  private activeDirectories(): string[] {
    try {
      return [...new Set(this.sessionsRepo.listActive().map((s) => s.cwd).filter(Boolean))];
    } catch {
      return [];
    }
  }

  private async _listen(directory: string): Promise<void> {
    const entry = this.streamsByDirectory.get(directory);
    if (!entry) return;
    try {
      for await (const event of entry.eventStream) {
        if (entry.abort.signal.aborted) break;
        this._relayEvent(event);
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      logger.error(
        `[OpencodeStreamBridge] Event stream error for ${directory}:`,
        err,
      );
    } finally {
      const entry = this.streamsByDirectory.get(directory);
      if (entry?.questionPoll) clearInterval(entry.questionPoll);
      this.streamsByDirectory.delete(directory);
    }
  }

  /**
   * #736 — Layer 2 dispatch-time tool-gating backstop.
   *
   * Decide whether a tool call on `localSessionId` is permitted by the
   * session's persisted MCP allowlist. Returns `true` (allowed) for any
   * session that is NOT role-scoped (`mcp_role` is null) — full pass-through,
   * matching the #736 "sessions with no mcp_role are unaffected" criterion.
   *
   * For a role-scoped session it delegates to the pure `isToolAllowed`
   * predicate against the row's `mcpAllowedToolsJson` (the value C1's
   * POST /agent-sessions path persisted). A DB read failure fails CLOSED for a
   * role-scoped session (deny), because a role-scoped session that cannot prove
   * a tool is allowed must not run it. If the row cannot be found at all we
   * cannot know the role, so we pass through (the part path still forwards as
   * before) — the permission path additionally fails closed where it can.
   *
   * #818 (org-optimizer-02) — this is also the single choke point for
   * best-effort denied-tool telemetry: when (and only when) the guard is
   * about to return `false`, fire an async, fire-and-forget write to
   * `denied_tool_events` so the org audit can later read "profile X was
   * denied tool Y N times". Logging is wrapped so it can NEVER throw into
   * this method or change the boolean being returned — fail-open for
   * logging, fail-closed for the guard decision itself. Only the tool NAME is
   * recorded, never args/payloads.
   */
  private isToolAllowedForSession(
    localSessionId: string | undefined,
    toolName: string,
  ): boolean {
    if (OPENCODE_NATIVE_TOOLS.has(toolName)) return true;
    if (!localSessionId) return true;
    let session;
    try {
      session = this.sessionsRepo.findById(localSessionId);
    } catch (err) {
      logger.error(
        '[OpencodeStreamBridge] #736 allowlist lookup failed:',
        err,
      );
      return true; // unknown role — do not over-block on an infra error.
    }
    if (!session) return true;
    // Only sessions that opted into a role are gated. No role → pass-through.
    if (session.mcpRole == null) return true;
    const allowed = isToolAllowed(toolName, session.mcpAllowedToolsJson);
    if (!allowed) {
      try {
        this.deniedToolEventsRepo
          .recordAsync({
            sessionId: localSessionId,
            agentConfigId: this._resolveDeniedAgentConfigId(session),
            toolName,
          })
          .catch((err) => {
            logger.error(
              '[OpencodeStreamBridge] #818 denied-tool-event logging failed:',
              err,
            );
          });
      } catch (err) {
        // Defensive: recordAsync is expected to always return a promise, but
        // never let a synchronous throw here affect the guard decision below.
        logger.error(
          '[OpencodeStreamBridge] #818 denied-tool-event logging failed:',
          err,
        );
      }
    }
    return allowed;
  }

  /**
   * #818 follow-up — best-effort profile attribution for a denied tool call.
   *
   * `agent_sessions` has no dedicated agent_config_id column, but two fields
   * on the row are logical references to `agent_configs.id`:
   *
   *  1. `mcp_role` — on the #765 interactive path, ws_gateway persists the
   *     resolved profile scope's `role`, which agent_profile_scope builds as
   *     the agentConfigId of the ENFORCING profile (the per-turn picked agent,
   *     falling back to the session's agentKind). This is the profile whose
   *     allowlist actually caused the deny, so it is checked first. Legacy
   *     paths (POST /agent-sessions C1, agent_runner role-slug) may instead
   *     store a `.mcp-roles/<slug>` role name that is NOT a profile id.
   *  2. `agent_kind` — a logical FK to agent_configs.id per the schema comment
   *     ("agentKind IS the agent_configs id", agent_runner); the scheduled
   *     path records real profile ids here.
   *
   * Each candidate is validated against a real `agent_configs` row before use
   * so legacy role slugs (or placeholder kinds like '__pending__') never
   * pollute the telemetry column. Any lookup error → null: attribution is
   * best-effort and must never throw into the dispatch path.
   */
  private _resolveDeniedAgentConfigId(session: AgentSession): string | null {
    try {
      for (const candidate of [session.mcpRole, session.agentKind]) {
        if (typeof candidate !== 'string') continue;
        const trimmed = candidate.trim();
        if (!trimmed) continue;
        if (this.agentConfigsRepo.getById(trimmed)) return trimmed;
      }
    } catch (err) {
      logger.error(
        '[OpencodeStreamBridge] #818 agent_config_id resolution failed (logging null):',
        err,
      );
    }
    return null;
  }

  /**
   * #736 — Surface a clear "denied" result to the client for a blocked tool
   * call. Emitted as a dedicated `tool.denied` frame (so the Flutter client can
   * render a denied tool affordance) plus a back-compat `error` frame.
   */
  private broadcastToolDenied(
    eventId: string,
    localSessionId: string | undefined,
    toolName: string,
  ): void {
    const message = `Tool "${toolName}" is not permitted for this agent's role and was blocked.`;
    broadcast({
      v: 1,
      type: 'tool.denied',
      id: eventId,
      sessionId: localSessionId ?? eventId,
      tool: toolName,
      message,
    });
    broadcast({
      v: 1,
      type: 'error',
      id: eventId,
      message,
    });
  }

  /**
   * #1379 Phase 2 — republish one `/global/event` frame to the mobile fan-out
   * hub. `subscribeToGlobalEvents` unwraps the engine's
   * `{directory, payload}` envelope into `{...payload, __directory}`; the
   * mobile project filter is fail-closed on the `directory` field, so the
   * envelope has to be reassembled exactly before it goes out.
   */
  private _publishToHub(
    event: import('@opencode-ai/sdk').RhythmEvent & { __directory?: string },
  ): void {
    const { __directory: directory, ...payload } = event;
    opencodeEventHub.publish(
      directory === undefined ? { payload } : { directory, payload },
    );
  }

  private _relayEvent(
    event: import('@opencode-ai/sdk').RhythmEvent,
  ): void {
    // Extract the Opencode session ID — different event types nest it
    // differently:
    //   session.*           → properties.sessionID
    //   message.updated     → properties.info.sessionID  (message.info.sessionID)
    //   message.part.updated→ properties.part.sessionID
    //   message.removed     → properties.sessionID
    //   session.updated     → properties.info.id  (Session.id, not sessionID)
    const props = (event.properties ?? {}) as Record<string, unknown>;
    const propsInfo = props.info as Record<string, unknown> | undefined;
    const propsPart = props.part as Record<string, unknown> | undefined;
    const opencodeSessionId = (props.sessionID ??
      propsInfo?.sessionID ??
      // session.updated carries Session shape where id = sdk session id
      propsInfo?.id ??
      propsPart?.sessionID) as string | undefined;

    // Look up the local session ID from the opencodeSessionMap.
    // Map is opencodeSessionId → localSessionId, so we need to reverse look up.
    let localSessionId: string | undefined;
    if (opencodeSessionId) {
      for (const [localId, sdkId] of opencodeSessionMap.entries()) {
        if (sdkId === opencodeSessionId) {
          localSessionId = localId;
          break;
        }
      }

      // #751 — The in-memory opencodeSessionMap is ephemeral: it is wiped on
      // every api_server restart and is not guaranteed to be populated at the
      // instant a freshly-created session's first events arrive. When the
      // reverse-lookup misses, fall back to the DURABLE `sdk_session_id` column
      // (persisted at create/resume time). Without this fallback EVERY event for
      // the session is dropped — status never leaves the 'starting' DB default,
      // message parts never persist, and the parent of a delegated subagent is
      // unresolvable — leaving the chat frozen on "Starting" while the engine
      // actually ran the whole turn. Lazily repopulate the map on a hit so
      // subsequent events for this session take the fast in-memory path.
      if (!localSessionId) {
        try {
          const row = this.sessionsRepo.findBySdkSessionId(opencodeSessionId);
          if (row) {
            localSessionId = row.id;
            opencodeSessionMap.set(row.id, opencodeSessionId);
          }
        } catch (err) {
          logger.error(
            '[OpencodeStreamBridge] DB fallback session lookup failed:',
            err,
          );
        }
      }
    }

    // C2: any event for this session is observable progress — cancel a
    // pending glob watchdog (see armGlobWatchdog) before it can fire.
    if (localSessionId) {
      this.clearGlobWatchdog(localSessionId);
    }

    // OPC-M1-4: If the local session has been explicitly stopped (via
    // stopStream), drop all events for it. The shared SSE subscription stays
    // alive for other sessions in the same directory.
    if (localSessionId && this.stoppedSessions.has(localSessionId)) {
      return;
    }

    // OCU-16 (#1057) — worktree lifecycle events are project-scoped, NOT
    // session-scoped (they carry no sessionID). Handle them here, BEFORE the
    // no-session-id generic fallback below, so they surface as typed top-level
    // WS frames the Flutter client can react to directly.
    // Cast the event to a loose shape: the generated SDK `Event` union does not
    // declare the experimental worktree events, so a direct `event.type ===`
    // comparison narrows `event` to `never`. Read type/properties off the
    // widened view instead.
    const wtEvent = event as { type: string; properties?: Record<string, unknown> };
    if (wtEvent.type === 'worktree.ready') {
      const wp = (wtEvent.properties ?? {}) as { name?: string; branch?: string };
      broadcast({
        v: 1,
        type: 'worktree.ready',
        name: wp.name ?? '',
        ...(wp.branch ? { branch: wp.branch } : {}),
      });
      return;
    }
    if (wtEvent.type === 'worktree.failed') {
      const wp = (wtEvent.properties ?? {}) as { message?: string };
      broadcast({
        v: 1,
        type: 'worktree.failed',
        message: wp.message ?? 'worktree operation failed',
      });
      return;
    }

    // OCU-22 (#1063) — vcs.branch.updated is project-scoped (no sessionID).
    // Relay it as a typed top-level WS frame so the transcript-header branch
    // badge refreshes live when an agent switches branches.
    if (wtEvent.type === 'vcs.branch.updated') {
      const vp = (wtEvent.properties ?? {}) as { branch?: string };
      broadcast({
        v: 1,
        type: 'vcs.branch.updated',
        ...(vp.branch ? { branch: vp.branch } : {}),
      });
      return;
    }

    // If no session mapping found, use the event's sessionID as a fallback key
    const eventId = localSessionId ?? opencodeSessionId;
    if (!eventId) {
      // Events without a session ID (e.g. file.edited) are still broadcast
      // with the event type so Flutter can handle them globally if needed
      broadcast({
        v: 1,
        type: 'event',
        eventType: event.type,
        properties: event.properties ?? {},
      });
      return;
    }

    // Map Opencode event types to Flutter's expected WS message format
    switch (event.type) {
      case 'message.part.updated': {
        // Forward the full part object to the client so it can mirror
        // Opencode Desktop's `setStore("part", messageID, ...)` pattern —
        // upsert by part.id keyed under part.messageID.
        //
        // OPC-M1-2 — message.part.updated is the ONLY carrier of part data.
        // UpdatedEventSchema carries only { sessionID, info } — no parts.
        // Persist the part into the DB row's parts_json here.
        const part = props?.part as Record<string, unknown> | undefined;
        if (part) {
          // #736 — Layer 2 dispatch backstop. If this is a tool-call part for a
          // disallowed tool on a role-scoped session, block it: do NOT forward
          // the part (which would render the tool as running/completed) and do
          // NOT persist it. Surface a denied result instead. This covers the
          // bypassPermissions path where no permission.asked event fires.
          if (part.type === 'tool') {
            const toolName =
              (part.tool as string | undefined) ??
              (part.name as string | undefined) ??
              '';
            if (toolName && !this.isToolAllowedForSession(localSessionId, toolName)) {
              this.broadcastToolDenied(eventId, localSessionId, toolName);
              break;
            }
          }
          if (localSessionId) {
            try {
              const session = this.sessionsRepo.findById(localSessionId);
              void registerGeneratedMediaPart(part, session).then((artifact) => {
                if (!artifact) return;
                const hostedPart = withHostedArtifactMetadata(part, artifact);
                broadcast({
                  v: 1,
                  type: 'message.part.updated',
                  id: eventId,
                  part: hostedPart,
                });
                const sdkMessageId = hostedPart.messageID as string | undefined;
                if (sdkMessageId) {
                  this.messagesRepo.upsertPart(localSessionId, sdkMessageId, hostedPart);
                }
              }).catch((error) => {
                logger.error(
                  '[OpencodeStreamBridge] Failed to register generated media:',
                  error,
                );
              });
            } catch (error) {
              logger.error(
                '[OpencodeStreamBridge] Failed to register generated media:',
                error,
              );
            }
          }
          broadcast({
            v: 1,
            type: 'message.part.updated',
            id: eventId,
            part,
          });

          // Persist part to DB.
          if (localSessionId) {
            const sdkMessageId = part.messageID as string | undefined;
            if (sdkMessageId) {
              try {
                // When part.updated arrives, the authoritative text is in the
                // part object — discard any in-memory delta accumulator for
                // this part since the full value supersedes it.
                const partId = part.id as string | undefined;
                if (partId) {
                  this.pendingPartDeltas.delete(`${sdkMessageId}:${partId}`);
                }
                this.messagesRepo.upsertPart(localSessionId, sdkMessageId, part);
              } catch (err) {
                logger.error('[OpencodeStreamBridge] Failed to persist part:', err);
              }
            }
          }
        }
        break;
      }

      case 'message.part.delta': {
        // Streaming text delta during an assistant turn. Forward verbatim
        // so the client can append delta into the right part by partID.
        //
        // OPC-M1-2 — Write-through delta to DB immediately via applyPartDelta
        // so a bridge restart loses at most in-flight (unwritten) deltas. The
        // authoritative full-text arrives later in message.part.updated, which
        // overwrites the accumulated value, making delta accumulation lossless
        // across a normal turn.
        //
        // Flush points for pendingPartDeltas in-memory accumulator (used only
        // for the legacy transcript.append broadcast on session.idle):
        //   1. Next message.part.updated for the same part — full value replaces.
        //   2. message.updated for the same message — delta discarded.
        //   3. session.idle — full turn boundary flush.
        const messageID = props?.messageID as string | undefined;
        const partID = props?.partID as string | undefined;
        const field = props?.field as string | undefined;
        const delta = props?.delta as string | undefined;
        if (delta && field === 'text' && localSessionId) {
          // Keep the per-session accumulator so we can persist assistant turns on idle.
          this.pendingText.set(
            localSessionId,
            (this.pendingText.get(localSessionId) ?? '') + delta,
          );
          // Keep per-part accumulator for structured transcript.
          if (messageID && partID) {
            const key = `${messageID}:${partID}`;
            const existing = this.pendingPartDeltas.get(key);
            if (existing) {
              existing.text += delta;
            } else {
              this.pendingPartDeltas.set(key, { sdkMessageId: messageID, partId: partID, text: delta });
            }
          }
        }
        if (messageID && partID && typeof delta === 'string') {
          broadcast({
            v: 1,
            type: 'message.part.delta',
            id: eventId,
            messageId: messageID,
            partId: partID,
            field: field ?? 'text',
            delta,
          });
          // Write-through to DB — bounded loss on restart (only unsaved deltas lost).
          if (localSessionId && field) {
            try {
              this.messagesRepo.applyPartDelta(localSessionId, messageID, partID, field, delta);
            } catch (err) {
              logger.error('[OpencodeStreamBridge] Failed to apply part delta to DB:', err);
            }
          }
        }
        // Keep legacy `output` event for older client builds.
        if (delta && field === 'text') {
          broadcast({
            v: 1,
            type: 'output',
            id: eventId,
            data: delta,
          });
        }
        break;
      }

      case 'message.updated': {
        // Forward the full message info so the client can upsert it under
        // its sessionID — same as Opencode Desktop's reducer pattern.
        //
        // OPC-M1-2 — IMPORTANT: the real UpdatedEventSchema = { sessionID, info }
        // carries NO parts field. Parts arrive exclusively via message.part.updated.
        // We only persist info-level metadata (role, tokens, cost) here and
        // deliberately preserve any parts_json already accumulated in the DB row.
        const info = props?.info as Record<string, unknown> | undefined;
        if (info) {
          broadcast({
            v: 1,
            type: 'message.updated',
            id: eventId,
            info,
          });
        }
        // Legacy flush event kept for back-compat.
        broadcast({
          v: 1,
          type: 'output.flush',
          id: eventId,
          properties: event.properties ?? {},
        });

        if (localSessionId && info) {
          try {
            const sdkMessageId = info.id as string | undefined;
            const role = info.role as string | undefined;
            const tokens = (info.tokens ?? null) as Record<string, unknown> | null;
            const cost = typeof info.cost === 'number' ? info.cost : null;

            if (sdkMessageId && role) {
              const dbRole: 'output' | 'input' | 'system' =
                role === 'assistant' ? 'output' : role === 'user' ? 'input' : 'system';
              // upsertMessageInfo preserves existing parts_json — does NOT clobber
              // parts accumulated from earlier message.part.updated events.
              this.messagesRepo.upsertMessageInfo(
                localSessionId,
                sdkMessageId,
                dbRole,
                tokens != null ? JSON.stringify(tokens) : null,
                cost,
              );

              // #930 — record the turn's user-message id as the revert target
              // for a mid-run cross-provider re-dispatch.
              if (role === 'user') noteUserMessage(localSessionId, sdkMessageId);

              // Backfill the session's actual model from the assistant message
              // (opencode reports providerID/modelID even when the session was
              // created without an explicit pick). Only fills when empty, then
              // broadcasts so the context panel + model-derived icon update live.
              if (role === 'assistant') {
                const providerID = info.providerID as string | undefined;
                const modelID = info.modelID as string | undefined;
                if (providerID && modelID) {
                  const modelled = this.sessionsRepo.backfillModel(
                    localSessionId,
                    providerID,
                    modelID,
                  );
                  if (modelled) broadcastSessionUpdated(modelled);
                }
              }
            }
          } catch (err) {
            logger.error('[OpencodeStreamBridge] Failed to persist message info:', err);
          }
        }
        break;
      }

      case 'message.removed': {
        const messageID = props?.messageID as string | undefined;
        if (messageID) {
          broadcast({
            v: 1,
            type: 'message.removed',
            id: eventId,
            messageId: messageID,
          });
          // OPC-M1-2 — Delete the row from the DB.
          if (localSessionId) {
            try {
              this.messagesRepo.deleteBySdkMessageId(localSessionId, messageID);
            } catch (err) {
              logger.error('[OpencodeStreamBridge] Failed to delete message row:', err);
            }
          }
        }
        break;
      }

      case 'message.part.removed': {
        const messageID = props?.messageID as string | undefined;
        const partID = props?.partID as string | undefined;
        if (messageID && partID) {
          broadcast({
            v: 1,
            type: 'message.part.removed',
            id: eventId,
            messageId: messageID,
            partId: partID,
          });
          // OPC-M1-2 — Remove the part from parts_json in the DB.
          if (localSessionId) {
            try {
              this.messagesRepo.removePart(localSessionId, messageID, partID);
            } catch (err) {
              logger.error('[OpencodeStreamBridge] Failed to remove part from DB:', err);
            }
          }
        }
        break;
      }

      case 'session.status': {
        // status.type tells us busy | idle | retry
        const statusProps = event.properties as Record<string, unknown>;
        const status = statusProps?.status as { type: string; attempt?: number; message?: string; next?: number } | undefined;
        if (status) {
          if (status.type === 'retry') {
            // OPC-M2-4: relay retry as a distinct WS status 'retrying' carrying
            // attempt count and reason. Do NOT persist to DB (retry is transient;
            // the session is still in its prior persistent status). Do NOT update
            // the DB row — idle/busy transitions do that; retry is in-flight.
            broadcast({
              v: 1,
              type: 'session.status',
              id: eventId,
              working: true,
              status: 'retrying',
              attempt: status.attempt ?? 1,
              reason: status.message ?? '',
            });
            // No DB update for retry — the session status stays at its previous value
            // (busy/working). The retrying state is surfaced purely in the WS frame.
          } else {
            // idle or busy — existing behaviour unchanged.
            broadcast({
              v: 1,
              type: 'session.status',
              id: eventId,
              working: status.type === 'busy',
              status: status.type,
            });
            // Persist to DB so the agents list badge moves off "Starting".
            // OPC-M1-4: Skip the update if the session DB row is already in
            // status='error' — otherwise the SDK's idle event would clobber
            // the persisted error state. We read from DB (not an in-memory set)
            // so the check survives bridge restarts.
            const currentStatus = (() => {
              try {
                return this.sessionsRepo.findById(localSessionId!)?.status;
              } catch { return undefined; }
            })();
            if (localSessionId && currentStatus !== 'error') {
              try {
                const dbStatus = status.type === 'busy' ? 'working' : 'idle';
                this.sessionsRepo.updateStatus(localSessionId, dbStatus);
                const updated = this.sessionsRepo.findById(localSessionId);
                if (updated) broadcastSessionUpdated(updated);
              } catch (err) {
                logger.error(
                  '[OpencodeStreamBridge] Failed to update session status:',
                  err,
                );
              }
            }
          }
        }
        break;
      }

      case 'session.idle': {
        broadcast({
          v: 1,
          type: 'session.status',
          id: eventId,
          working: false,
        });
        // #930 — turn boundary: drop the retained re-dispatch buffer. No-op
        // while a handoff decision is still in flight (see clearTurn docs).
        if (localSessionId) clearTurn(localSessionId);
        // OPC-M1-4: Check DB for error status instead of in-memory set.
        const idleSessionStatus = (() => {
          try {
            return localSessionId ? this.sessionsRepo.findById(localSessionId)?.status : undefined;
          } catch { return undefined; }
        })();
        if (localSessionId && idleSessionStatus !== 'error') {
          try {
            this.sessionsRepo.updateStatus(localSessionId, 'idle');
            const updated = this.sessionsRepo.findById(localSessionId);
            if (updated) broadcastSessionUpdated(updated);
          } catch (err) {
            logger.error(
              '[OpencodeStreamBridge] Failed to update session status to idle:',
              err,
            );
          }
          // Finalize the assistant turn into the Flutter transcript via
          // `transcript.append` and clear the pending buffer. Without this
          // broadcast, the streaming delta text lives only in the Flutter
          // `_liveOutputBuffer` preview and never appears as a finalized
          // assistant message in the chat history.
          //
          // OPC-M1-2: When structured messages are already persisted (from
          // message.part.updated events), skip the legacy DB append — it would
          // create a duplicate row. We still broadcast transcript.append so the
          // Flutter client finalizes the live preview. Legacy sessions (no SDK
          // message IDs) still use the append path for DB persistence.
          const text = this.pendingText.get(localSessionId);
          if (text && text.length > 0) {
            const hasStructured = this.messagesRepo.hasStructuredMessages(localSessionId);
            if (!hasStructured) {
              // Legacy path: no structured messages — persist the plain-text row.
              try {
                this.messagesRepo.append(localSessionId, 'output', text, text);
                this.sessionsRepo.updatePreview(
                  localSessionId,
                  text.slice(0, 200),
                  new Date().toISOString(),
                );
              } catch (err) {
                logger.error(
                  '[OpencodeStreamBridge] Failed to persist assistant turn:',
                  err,
                );
              }
            } else {
              // Structured path: raw_text already updated by upsertPart/applyPartDelta.
              // Just update the session preview from the accumulated text.
              try {
                this.sessionsRepo.updatePreview(
                  localSessionId,
                  text.slice(0, 200),
                  new Date().toISOString(),
                );
              } catch (err) {
                logger.error(
                  '[OpencodeStreamBridge] Failed to update session preview:',
                  err,
                );
              }
            }
            broadcast({
              v: 1,
              type: 'transcript.append',
              id: localSessionId,
              role: 'output',
              text,
            });
            this.pendingText.delete(localSessionId);
            // Clear per-part delta accumulators — turn boundary reached.
            this.pendingPartDeltas.clear();

            // P2-2: fire-and-forget background skill extraction now that the
            // assistant turn has been persisted. This is the WS/interactive
            // turn-completion point (the >= 2 rounds gate is enforced inside
            // queueSkillExtraction). Must NOT block or reject the turn.
            queueSkillExtraction(localSessionId);

            // #929 / #1109 — schedule (not run) evaluation of any harvested
            // draft that just crossed its use threshold. Placed HERE (not in
            // ws_gateway.ts right after promptFn) because this is the actual
            // WS/interactive turn-completion point — promptFn/promptAsync
            // resolves before the turn's `skill`-tool call is durably
            // persisted, so evaluating there always sees the PREVIOUS turn's
            // usage count. #1109: no longer calls evaluateHarvestedDrafts()
            // directly on every turn (that fanned out into a scorer/rewrite
            // session per turn) — scheduleIdleEvaluation coalesces a burst of
            // turns into ONE sweep after the loop goes idle. NEVER throws.
            scheduleIdleEvaluation();

            // #876 — "on first use" lazy dependency install. The real skill
            // invocation happens inside the vendored fork's `skill` tool
            // (out of reach here); the persisted tool-call PARTS for this
            // session (upsertPart, above) are the only observable record of
            // which skills were actually invoked. Scan them for `skill` tool
            // calls and best-effort install each invoked skill's declared
            // python_dependencies. Fire-and-forget, never blocks/rejects the
            // turn — mirrors queueSkillExtraction's posture exactly.
            try {
              const structured = this.messagesRepo.listBySessionStructured(localSessionId);
              const allParts = structured.flatMap((m) => m.parts ?? []);
              const invokedSkillNames = extractInvokedSkillNamesFromParts(allParts);
              if (invokedSkillNames.length > 0) {
                ensureLazyDepsForTurn(invokedSkillNames).catch((err) =>
                  logger.warn(`[OpencodeStreamBridge] ensureLazyDepsForTurn failed (non-fatal): ${String(err)}`),
                );
              }
            } catch (err) {
              logger.warn(`[OpencodeStreamBridge] lazy-deps turn scan failed (non-fatal): ${String(err)}`);
            }
          } else {
            // Zero tokens streamed this turn — surface as user-visible error (#636)
            broadcast({
              v: 1,
              type: 'error',
              id: localSessionId,
              message: 'The model returned an empty response.',
            });
          }
          // #1123 — callback boundary for additive interactive async
          // delegation. Run only AFTER the existing assistant persistence and
          // transcript finalization above. The service ignores non-async child
          // rows, durably dedupes replayed idle events, defers while a parent is
          // busy, and coalesces concurrent child completions. A session may be
          // both a delegated child and a manager parent, so run both roles in
          // sequence. Never block or reject SSE processing.
          void asyncDelegationCompletionService
            .onChildIdle(localSessionId)
            .then(() => asyncDelegationCompletionService.onParentIdle(localSessionId))
            .catch((err) =>
              logger.error(
                `[OpencodeStreamBridge] async delegation idle callback failed for ${localSessionId}:`,
                err,
              ),
            );

          // Specialist reports are discovered from persisted session output; indexing
          // is deliberately detached from event relay and can never delay a turn.
          indexResearchSession(localSessionId).catch((err) =>
            logger.warn(`[OpencodeStreamBridge] specialist research indexing failed: ${String(err)}`),
          );
        }
        break;
      }

      case 'session.diff': {
        // OPC-M3-1: relay session.diff events so the Flutter Changes tab knows
        // to refetch GET /agent-sessions/:id/diff for the affected session.
        // The event carries no diff payload itself — the client must call the
        // REST endpoint to get the full FileDiff array.
        broadcast({
          v: 1,
          type: 'session.diff',
          id: eventId,
        });
        break;
      }

      case 'session.compacted': {
        // #720 — opencode signals compaction completion with `session.compacted`
        // ({ properties: { sessionID } }), NOT a live `compaction` message-part.
        // Relay it as a dedicated WS frame so the Flutter client can clear the
        // compacting spinner AND rehydrate (re-fetch messages) so the persisted
        // CompactionPart loads and renders as the "Conversation compacted"
        // divider, and the context gauge reflects the post-compaction tokens.
        // The event carries no message payload itself — the client refetches
        // GET /agent-sessions/:id (same as the diff refetch path).
        broadcast({
          v: 1,
          type: 'session.compacted',
          id: eventId,
        });
        break;
      }

      case 'todo.updated': {
        // OPC-M3-5: relay todo.updated events so the Flutter todo panel can
        // update in real-time without polling. The full todo list is embedded
        // in the event properties — no REST refetch needed.
        const todoProps = event.properties as Record<string, unknown>;
        const todos = todoProps?.todos as Array<unknown> | undefined;
        broadcast({
          v: 1,
          type: 'todo.updated',
          id: eventId,
          todos: todos ?? [],
        });
        break;
      }

      case 'session.created': {
        // #743 — When the session.created event carries a parentID on info,
        // the engine has spawned a child (subagent/task-delegated) session.
        // Persist a local agent_sessions row so the inspector can resolve
        // /diff, token counts, and messages without 404ing.
        //
        // Event shape (opencode fork + upstream): properties = { sessionID, info: Session.Info }
        // Session.Info.parentID is present when created via the `task` tool.
        const createdInfo = (event.properties as Record<string, unknown>)?.info as Record<string, unknown> | undefined;
        const createdParentId = createdInfo?.parentID as string | undefined;
        if (createdParentId && opencodeSessionId) {
          // Child session: persist and register.
          const childTitle = (createdInfo?.title as string | undefined) ?? '';
          const childCwd = (createdInfo?.directory as string | undefined) ?? '';
          // Recording-gap fix: the engine carries the child's resolved MCP
          // scope on info.mcpAllowlist (Session.Info, see projectors.ts
          // `mcp_allowlist: grab(info, "mcpAllowlist")`) — persist it into the
          // existing mcp_allowed_tools_json column so the agent-sessions API
          // stops reporting NULL for task-spawned children.
          const childMcpAllowlist = createdInfo?.mcpAllowlist as unknown;
          try {
            const childRow = this.sessionsRepo.upsertChildSession(
              opencodeSessionId,
              createdParentId,
              childTitle,
              childCwd,
              childMcpAllowlist ? JSON.stringify(childMcpAllowlist) : null,
            );
            if (childRow) {
              // Register in the session map so subsequent events route correctly.
              opencodeSessionMap.set(childRow.id, opencodeSessionId);
              // Broadcast the new child session so live Flutter clients update their list.
              broadcastSessionUpdated(childRow);
              logger.info(
                `[OpencodeStreamBridge] child session created: localId=${childRow.id} sdkId=${opencodeSessionId} parentSdkId=${createdParentId}`,
              );
            } else {
              logger.info(
                `[OpencodeStreamBridge] child session.created: parent SDK id ${createdParentId} not mapped yet — queued for durable parent resolution`,
              );
            }
          } catch (err) {
            logger.error('[OpencodeStreamBridge] Failed to upsert child session:', err);
          }
        }
        broadcast({
          v: 1,
          type: 'session.created',
          id: eventId,
          properties: event.properties ?? {},
        });
        break;
      }

      case 'session.updated': {
        // OPC-#710 — auto-title: opencode emits session.updated after the first
        // exchange with a generated title in info.title. Map it to the Rhythm
        // session name, persist it, and broadcast SessionUpdatedMessage so the
        // Flutter session list updates live without polling.
        //
        // NOTE: The SDK session id for routing lives in `properties.info.id`
        // (NOT in a top-level `properties.sessionID`). The `localSessionId` /
        // `eventId` resolved above already handles this via the opencodeSessionMap
        // reverse-lookup on `propsInfo?.sessionID` — but for session.updated the
        // SDK id is `info.id` (not `info.sessionID`). Re-resolve from info.id
        // to ensure correct mapping.
        const updatedInfo = props.info as Record<string, unknown> | undefined;
        if (updatedInfo && localSessionId) {
          const title = updatedInfo.title as string | undefined;
          if (title && title.trim().length > 0) {
            try {
              this.sessionsRepo.updateFields(localSessionId, { name: title.trim() });
              const updated = this.sessionsRepo.findById(localSessionId);
              if (updated) broadcastSessionUpdated(updated);
            } catch (err) {
              logger.error(
                '[OpencodeStreamBridge] Failed to update session name from session.updated:',
                err,
              );
            }
          }
        }
        break;
      }

      case 'session.error': {
        const errProps = event.properties as Record<string, unknown>;
        const errorInfo = errProps?.error as Record<string, unknown> | undefined;
        let message = extractErrorMessage(errorInfo);
        // #913 — orphaned tool_use/tool_result pairing surfaces as an opaque
        // Anthropic 400. Give it a distinct errorClass + human message so the
        // UI can tell it apart from a generic API error, instead of showing
        // the raw "tool_use ids were found without tool_result..." string.
        const isToolPairingError = TOOL_PAIRING_ERROR_PATTERN.test(message);
        if (isToolPairingError) {
          message =
            'Conversation history became inconsistent (tool call/result pairing). Send a new message to continue.';
        }
        // #930 — mid-run cross-provider re-dispatch. When a rate-limit
        // exhaustion handoff is being decided for this session ('defer'), do
        // NOT finalize the error: the spillover route re-dispatches the turn
        // (or finalizes with this message if no tier resolves). The partial
        // output is discarded (revert removes it engine-side; the pending
        // buffer is dropped here) — the user sees one final answer, not a
        // duplicate partial. A rate-limited replacement tier returns
        // 'cascade'; auth/schema/tool/other failures still finalize below.
        if (localSessionId) {
          const action = onSessionError(localSessionId, message, errorInfo);
          if (action === 'defer') {
            this.pendingText.delete(localSessionId);
            break;
          }
          if (action === 'cascade') {
            this.pendingText.delete(localSessionId);
            void advanceFallbackCascade(localSessionId, { message }).then((result) => {
              if (result.outcome === 'terminal') {
                finalizeErrorStatus(localSessionId!, result.error ?? message);
              }
            });
            break;
          }
        }
        if (localSessionId) {
          // OPC-M1-4: Flush any partial assistant text accumulated during the
          // turn so the user sees what arrived before the error. Then drop the
          // pending buffer so the follow-up session.idle doesn't re-emit it.
          const partial = this.pendingText.get(localSessionId);
          if (partial && partial.length > 0) {
            broadcast({
              v: 1,
              type: 'transcript.append',
              id: localSessionId,
              role: 'output',
              text: partial,
            });
            this.pendingText.delete(localSessionId);
          }
        }
        broadcast({
          v: 1,
          type: 'error',
          id: eventId,
          message,
          ...(isToolPairingError ? { errorClass: 'tool_pairing' } : {}),
        });
        // OPC-M1-4: Persist error state on the DB row (status='error',
        // status_message=message). This replaces the old in-memory
        // erroredSessions + 5s setTimeout sentinel:
        //   - Error state survives bridge restarts (persisted in SQLite).
        //   - No time-based auto-clear: error clears only on an explicit
        //     user action (new prompt → ws_gateway calls clearErrorStatus,
        //     or resume → controller transitions status to 'starting').
        //   - session.idle after session.error is suppressed by DB check
        //     (idleSessionStatus === 'error') — no race condition.
        if (localSessionId) {
          try {
            this.messagesRepo.append(
              localSessionId,
              'system',
              `Error: ${message}`,
              `Error: ${message}`,
            );
            this.sessionsRepo.setErrorStatus(localSessionId, message);
            const updated = this.sessionsRepo.findById(localSessionId);
            if (updated) broadcastSessionUpdated(updated);
            indexResearchSession(localSessionId).catch((indexErr) =>
              logger.warn(`[OpencodeStreamBridge] specialist research indexing failed: ${String(indexErr)}`),
            );
          } catch (err) {
            logger.error(
              '[OpencodeStreamBridge] Failed to persist session error:',
              err,
            );
          }
          // #1123 — a delegated child failure is still a completion the
          // interactive parent must hear about. Persist the normal error state
          // first, then queue the callback; native task children are ignored.
          void asyncDelegationCompletionService
            .onChildFailed(localSessionId, message)
            .catch((err) =>
              logger.error(
                `[OpencodeStreamBridge] async delegation error callback failed for ${localSessionId}:`,
                err,
              ),
            );
        }
        break;
      }

      // Handle BOTH event names. The generated SDK types only declare
      // `permission.updated` (Permission shape: {id,type,title,metadata}), but
      // the actual running opencode binary emits `permission.asked` (older
      // shape: {permissionID,toolName,summary,args}) — confirmed from the live
      // event trace. Listening for only one name dropped the request and hung
      // the write forever. Extract fields defensively from either shape.
      case 'permission.replied': {
        const reply = event.properties as { requestID?: string };
        if (localSessionId && reply.requestID) {
          this.markPermissionReplied(localSessionId, reply.requestID);
        }
        break;
      }

      case 'permission.asked':
      case 'permission.updated': {
        const perm = event.properties as {
          id?: string;
          permissionID?: string;
          type?: string;
          toolName?: string;
          sessionID?: string;
          title?: string;
          summary?: string;
          metadata?: Record<string, unknown>;
          args?: Record<string, unknown>;
          // The engine's real payload for a shell permission. It sends NO
          // `args`/`command` — the command text lives here, one entry per
          // parsed command node. See extractBashCommands.
          patterns?: unknown[];
          /** Permission id ('bash' | 'edit' | 'webfetch' | 'external_directory'). */
          permission?: string;
          /** Points at the tool part carrying the real, unsplit arguments. */
          tool?: { messageID?: string; callID?: string };
        };
        const permissionId = perm.permissionID ?? perm.id;
        if (!permissionId || !localSessionId) break;

        const sdkSessionId = opencodeSessionId ?? '';
        // The engine's Permission.Request carries the permission id in
        // `permission` — NOT `toolName` and NOT `type` (neither field exists on
        // it; `type` here only ever matched the outer envelope in tests). A real
        // ask looks like:
        //   {"permission":"bash","patterns":["git push --force …"],"metadata":{}}
        // so this resolved to '' for every engine permission, which silently
        // disabled BOTH the #736 allowlist backstop below and the #878 command
        // gate — a hardline `curl … | sh` reached the shell with no card.
        const toolName = perm.toolName ?? perm.type ?? perm.permission ?? '';
        const args = perm.args ?? perm.metadata ?? {};
        const summary = perm.summary ?? perm.title ?? toolName;

        // #736 — Layer 2 dispatch backstop (pre-execution gate). opencode blocks
        // the tool until this permission is answered, so denying here stops the
        // tool BEFORE it executes — the Odysseus `_execute_tool_block_impl`
        // analog. If the tool is outside a role-scoped session's allowlist,
        // auto-DENY it (reject) and surface a denied result instead of forwarding
        // the permission card or auto-accepting. Non-role sessions pass through.
        //
        // Several engine permission ids are SCOPES, not tools. Now that toolName
        // resolves from `perm.permission`, any of them can land here, and matching
        // one against a tool allowlist would deny it for every role-scoped session
        // — silently breaking doom-loop detection, plan transitions and questions.
        // Enumerated from the engine's own defaults in agent/agent.ts.
        const isToolScopedPermission = !NON_TOOL_PERMISSION_SCOPES.has(toolName);
        if (toolName && isToolScopedPermission && !this.isToolAllowedForSession(localSessionId, toolName)) {
          const dir = (() => {
            try {
              return this.sessionsRepo.findById(localSessionId)?.cwd;
            } catch {
              return undefined;
            }
          })();
          void opencodeClient.replyToPermission(
            permissionId,
            'reject',
            `Tool '${toolName}' is not in this session's allowlist.`,
            dir,
            sdkSessionId,
          );
          broadcast({
            v: 1,
            type: 'permission.resolved',
            sessionId: localSessionId,
            permissionId,
            decision: 'deny',
          });
          this.broadcastToolDenied(localSessionId, localSessionId, toolName);
          break;
        }

        // Consult the session's permission_mode to decide whether to
        // auto-respond or forward to the user.
        //
        // Resolved HERE, above the #878 bash gate, because #878's `ask` branch
        // needs to know whether anyone is actually listening. See the
        // `isUnattended` note in that branch.
        let permissionMode: PermissionMode = 'default';
        let dbSession: ReturnType<AgentSessionsRepository['findById']> | undefined;
        try {
          dbSession = this.sessionsRepo.findById(localSessionId);
          permissionMode = (dbSession?.permissionMode ?? 'default') as PermissionMode;
        } catch (err) {
          logger.error('[OpencodeStreamBridge] Failed to load session for permission mode:', err);
        }

        // #1156 — Delegated subagent/child sessions (spawned via the engine's
        // `task` tool) get a local row via upsertChildSession with
        // permission_mode left NULL (-> 'default'), and there is no Flutter UI
        // watching a headless child to answer a forwarded permission.asked —
        // the write hung indefinitely. A row is "headless" when it has a
        // non-null parentSessionId (delegated child — the sole writer of that
        // column is upsertChildSession) or when no row resolves at all (the
        // create-vs-permission race: the child row hasn't been upserted yet).
        // An interactive/UI session ALWAYS resolves to a row with
        // parentSessionId===NULL (POST /agent-sessions never sets it), so this
        // never widens auto-accept for a real interactive prompt (c5 guard).
        // ponytail: heuristic keyed on parent-id-presence, not a full
        // isHeadless field — cheapest signal that already distinguishes every
        // known case; revisit if a headless session type ever gets a null
        // parent id.
        // plan-mode auto-deny must stay authoritative over the new headless
        // auto-accept — a child explicitly placed in plan mode must not run.
        // Computed first so `isHeadless` below can defer to it.
        const shouldAutoDeny = permissionMode === 'plan';
        const isDelegatedChild = !dbSession || dbSession.parentSessionId != null;
        const isHeadless = !shouldAutoDeny && isDelegatedChild;

        // True when NOTHING is watching this session for an approval answer.
        //
        // NOT the same thing as `bypassPermissions`. A bypass session may still
        // be interactive, but its explicit contract is that non-hardline asks
        // auto-resolve without surfacing. `isUnattended` remains the separate
        // signal used for default/acceptEdits sessions with no possible viewer.
        //
        // The two shapes where no human can possibly answer:
        //   • a delegated child (#1156 — no UI watches a subagent)
        //   • a scheduler-originated system run (`is_system` + a scheduled task
        //     id; the same discriminator the unattended auto-approve path uses)
        //
        // Deliberately NOT guarded on `shouldAutoDeny`: a plan-mode unattended
        // session must also skip registering a card (nobody would answer it),
        // and instead fall through to the auto-DENY below, where plan mode
        // stays authoritative. Gating this on !shouldAutoDeny would re-create
        // the hang for exactly that combination.
        const isScheduledRun = Boolean(dbSession?.isSystem && dbSession?.scheduledTaskId);

        // POSITIVE EVIDENCE ONLY. `isDelegatedChild` above is true when NO row
        // resolves at all (`!dbSession`) — deliberate for #1156's auto-accept,
        // which covers the transient create-vs-permission race. It must NOT
        // qualify a session as unattended for the #878 branch below: an unknown
        // session is exactly the case where we CANNOT prove no human is
        // watching, and a session created directly against the engine has no
        // Rhythm row at all. Requiring a real parent id (or a scheduler run)
        // means only provable unattendedness skips the approval card.
        //
        // Found by smoke test 2026-08-04 (E2): a session created straight on
        // the engine under bypassPermissions ran `git push --force` with no card,
        // because `!dbSession` had made it "unattended".
        const isUnattended = Boolean(dbSession?.parentSessionId) || isScheduledRun;

        // #878 — command-approval classification for the bash tool. This runs
        // BEFORE the permissionMode auto-accept check below so a hardline-
        // blocked or high-risk command is never let through by
        // `bypassPermissions`/`acceptEdits` — approval gating for destructive
        // commands must not be weaker than the default prompt-driven flow.
        // Low-risk / explicitly-allowed commands fall through unchanged to the
        // existing permissionMode logic (no behavior change for safe commands).
        if (toolName.toLowerCase() === 'bash') {
          // `args` is empty for engine-issued shell permissions, and `patterns`
          // holds each parsed command NODE rather than the command line — so a
          // pipeline reaches us pre-split and `curl URL | sh` loses its pipe.
          // The full line is on the tool part the permission points at, so pull
          // that too and classify every candidate (#1322). A missing part (the
          // permission can beat message.part.updated) just falls back to
          // patterns, exactly as before.
          const toolInput =
            perm.tool?.messageID && perm.tool?.callID
              ? this.messagesRepo.findToolPartInput(
                  localSessionId,
                  perm.tool.messageID,
                  perm.tool.callID,
                )
              : null;
          const commands = extractBashCommands(args, perm.patterns, toolInput);
          const classification = commands.length
            ? classifyCommands(commands, resolveApprovalsMode())
            : null;
          if (classification) {
            if (classification.decision === 'deny') {
              const dir = (() => {
                try {
                  return this.sessionsRepo.findById(localSessionId)?.cwd;
                } catch {
                  return undefined;
                }
              })();
              void opencodeClient.replyToPermission(
                permissionId,
                'reject',
                `Command blocked: ${classification.detail} (reason: ${classification.reason})`,
                dir,
                sdkSessionId,
              );
              broadcast({
                v: 1,
                type: 'permission.resolved',
                sessionId: localSessionId,
                permissionId,
                decision: 'deny',
              });
              broadcast({
                v: 1,
                type: 'tool.denied',
                id: localSessionId,
                sessionId: localSessionId,
                tool: toolName,
                message: `Command blocked: ${classification.detail} (reason: ${classification.reason})`,
              });
              logger.warn(
                `[OpencodeStreamBridge] #878 denied bash command (reason=${classification.reason}): ${classification.detail}`,
              );
              break;
            }
            if (
              classification.decision === 'ask' &&
              permissionMode !== 'bypassPermissions' &&
              !isUnattended
            ) {
              // Force this to the pending/broadcast path below regardless of
              // permissionMode — a manual-mode or smart-uncertain command must
              // surface an approval ask even under acceptEdits.
              this.registerPermission(localSessionId, {
                permissionId,
                toolName,
                args,
                summary: `${summary} — ${classification.detail}`,
                sdkSessionId,
                patterns: Array.isArray(perm.patterns)
                  ? perm.patterns.filter((pattern): pattern is string => typeof pattern === 'string')
                  : [],
                title: perm.title ?? perm.summary ?? summary,
              });
              break;
            }
            if (classification.decision === 'ask') {
              // Registering a permission card here is a guaranteed hang for an
              // unattended session and contradicts the explicit autonomy
              // contract for bypassPermissions. `resolveApprovalsMode()`
              // defaults to 'manual', where every escalated command classifies
              // as ask; only the hardline deny branch above remains absolute.
              //
              // Falling through is safe because it does NOT weaken the parts of
              // #878 that actually protect anything: the hardline blocklist and
              // 'deny' classification are handled above and still break out
              // unconditionally. Only the "uncertain, ask a human" case is
              // downgraded to allow, and only where there is provably no human.
              logger.warn(
                `[OpencodeStreamBridge] #878 auto-allowing an 'ask' bash command in a ` +
                  `${permissionMode === 'bypassPermissions' ? 'bypass' : 'unattended'} session ` +
                  `(reason=${classification.reason}, ` +
                  `permissionMode=${permissionMode}, headless=${isHeadless}): ` +
                  `${classification.detail}`,
              );
              // fall through to the auto-accept path below
            }
            // classification.decision === 'allow' — fall through unchanged.
          }
        }

        const editTools = new Set(['write', 'edit', 'patch']);
        const shouldAutoAccept =
          permissionMode === 'bypassPermissions' ||
          (permissionMode === 'acceptEdits' && editTools.has(toolName.toLowerCase())) ||
          isHeadless ||
          // A scheduler-originated ROOT run has no parent, so `isHeadless` does
          // not cover it. In practice agent_runner sets its permission mode to
          // `bypassPermissions`, but depending on that left the whole
          // no-human-is-watching class one missed assignment away from hanging
          // again — children were found sitting at 'default' for exactly that
          // reason. Plan-guarded so an explicit plan-mode run still auto-denies.
          (!shouldAutoDeny && isScheduledRun);

        if (shouldAutoAccept || shouldAutoDeny) {
          const decision = shouldAutoAccept ? 'accept' : 'deny';
          // Pass the session cwd as directory — opencode scopes permissions per
          // directory; without it the auto-response doesn't unblock the tool.
          const dir = this.sessionsRepo.findById(localSessionId)?.cwd;
          // Auto-resolve via the modern reply endpoint. Plan-mode auto-deny
          // sends a reject classification message the agent sees next turn.
          void opencodeClient.replyToPermission(
            permissionId,
            shouldAutoAccept ? 'once' : 'reject',
            shouldAutoDeny
              ? "Auto-denied: session is in plan mode (read-only)."
              : undefined,
            dir,
            sdkSessionId,
          );
          // Broadcast a permission.resolved so Flutter can update its UI.
          broadcast({
            v: 1,
            type: 'permission.resolved',
            sessionId: localSessionId,
            permissionId,
            decision,
          });
          // C2: glob has no timeout of its own — arm a short watchdog now
          // that the tool is about to actually run, so a hang fails fast
          // (see armGlobWatchdog) instead of riding out the full run
          // inactivity window.
          if (shouldAutoAccept && toolName.toLowerCase() === 'glob') {
            this.armGlobWatchdog(localSessionId, sdkSessionId, dir);
          }
          break;
        }

        // Default / acceptEdits-but-non-edit path: register + broadcast.
        // registerPermission dedups against a permissionId already surfaced by
        // the GET /permission recovery poll (OCU-03 #1044).
        this.registerPermission(localSessionId, {
          permissionId,
          toolName,
          args,
          summary,
          sdkSessionId,
          patterns: Array.isArray(perm.patterns)
            ? perm.patterns.filter((pattern): pattern is string => typeof pattern === 'string')
            : [],
          title: perm.title ?? perm.summary ?? summary,
        });
        break;
      }

      // opencode answers its `question` (AskUserQuestion) tool through a
      // dedicated Question API, separate from permissions and session.input.
      // The agent calls `question` → opencode emits `question.asked` with a
      // QuestionRequest { id, sessionID, questions, tool:{callID} } and blocks
      // the tool at status:running until POST /question/{id}/reply arrives.
      // Without capturing the requestID here (and replying via the controller),
      // the tool hangs forever and the whole session stalls — for every model,
      // since they all run through the same opencode `build` agent.
      case 'question.asked': {
        const q = event.properties as {
          id?: string;
          requestID?: string;
          sessionID?: string;
          questions?: unknown[];
          tool?: { callID?: string; messageID?: string };
        };
        const requestId = q.id ?? q.requestID;
        if (!requestId || !localSessionId) break;
        this.registerQuestion(localSessionId, {
          requestId,
          callId: q.tool?.callID ?? '',
          sdkSessionId: opencodeSessionId ?? '',
          questions: Array.isArray(q.questions) ? q.questions : [],
        });
        break;
      }

      // opencode resolved the question (we replied, or another client did, or
      // it was rejected). Clear our pending entry and tell the client so the
      // card can stop showing the answer affordance.
      case 'question.replied':
      case 'question.rejected': {
        const q = event.properties as {
          requestID?: string;
          id?: string;
          answers?: unknown;
        };
        const requestId = q.requestID ?? q.id;
        if (!requestId || !localSessionId) break;
        this.clearPendingQuestion(localSessionId, requestId);
        broadcast({
          v: 1,
          type: 'question.resolved',
          sessionId: localSessionId,
          requestId,
          rejected: event.type === 'question.rejected',
        });
        break;
      }

      default: {
        // Relay any unrecognized event as a generic event
        broadcast({
          v: 1,
          type: 'event',
          id: eventId,
          eventType: event.type,
          properties: event.properties ?? {},
        });
        break;
      }
    }
  }

  /**
   * OPC-M1-4 — Stop relaying events for a specific local session.
   *
   * Unregisters the session from the routing/filter map so that any
   * subsequent SSE events for its SDK session ID are silently dropped —
   * no WS broadcast and no DB write. The shared SSE subscription for the
   * directory stays alive so other sessions in the same cwd are unaffected.
   *
   * Called by the controller on DELETE /agent-sessions/:id and destroy().
   */
  stopStream(localSessionId: string): void {
    this.stoppedSessions.add(localSessionId);
    // Also clean up the pending-text accumulator for this session so stale
    // deltas don't linger in memory after the session is closed.
    this.pendingText.delete(localSessionId);
    // Drop any pending questions for this session so the recovery poll cannot
    // resurface a card for a session the user has closed.
    const prefix = `${localSessionId}:`;
    for (const key of this.pendingQuestions.keys()) {
      if (key.startsWith(prefix)) this.pendingQuestions.delete(key);
    }
  }

  /**
   * OPC-M1-4 — Clear error state for a session on an explicit user action.
   *
   * Called by the ws_gateway when a session.input frame arrives for a
   * session that is currently in status='error'. Transitions the DB row to
   * status='working' and nulls out status_message so the next turn starts
   * fresh. No-op if the session is not in error state.
   */
  clearErrorStatus(localSessionId: string): void {
    try {
      this.sessionsRepo.clearErrorStatus(localSessionId);
      const updated = this.sessionsRepo.findById(localSessionId);
      if (updated) broadcastSessionUpdated(updated);
    } catch (err) {
      logger.error('[OpencodeStreamBridge] Failed to clear error status:', err);
    }
  }

  /** Clean up all streams. */
  dispose(): void {
    for (const [, entry] of this.streamsByDirectory) {
      if (entry.questionPoll) clearInterval(entry.questionPoll);
      entry.abort.abort();
    }
    this.streamsByDirectory.clear();
    // OCU-29 (#1070) — tear down the consolidated global stream + watchdog.
    if (this.globalStream) {
      try {
        this.globalStream.abort();
      } catch {
        /* best-effort */
      }
      clearInterval(this.globalStream.watchdog);
      this.globalStream = null;
    }
    // #1379 Phase 2 — a deliberate shutdown (unlike a watchdog resubscribe)
    // really does end the fan-out, so new mobile streams must go back to their
    // own engine transport rather than subscribing to a hub nobody feeds.
    opencodeEventHub.setLive(false);
    this.engineIdentityKey = null;
    this.stoppedSessions.clear();
    this.pendingText.clear();
    this.pendingPermissions.clear();
    this.repliedPermissions.clear();
    this.pendingQuestions.clear();
  }
}

/** Singleton stream bridge instance. */
export const streamBridge = new OpencodeStreamBridge();
