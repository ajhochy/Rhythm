/**
 * #930 — mid-run cross-provider re-dispatch on account exhaustion.
 *
 * When the vendored anthropic plugin reports total account exhaustion mid-turn
 * (POST /opencode/spillover {exhausted:true}), the in-flight turn is NOT dead —
 * the engine's retry policy (opencode_fork session/retry.ts) retries rate
 * limits with backoff and NO attempt cap, so a sustained 429 spins the turn in
 * 'working' forever and `session.error` never fires. The exhausted report is
 * therefore the TERMINAL signal (live-smoke evidence, 2026-07-08): the route
 * decides the next chain tier, then this module ABORTS the spinning turn,
 * reverts it, and re-prompts on the new provider — in the SAME engine session.
 *
 * Per AJ's decisions:
 *   - Resume the SAME engine session: abort the retry loop, revert the failed
 *     partial turn (opencodeClient.revertSession), re-prompt on the new tier.
 *   - Re-dispatch the FULL composed prompt (incl. the transient skill/memory
 *     prefaces) — ws_gateway retains it here per turn, cleared on normal
 *     completion.
 *   - Partial output of the interrupted turn is discarded (revert engine-side,
 *     pendingText dropped bridge-side).
 *   - At-most-once: a re-dispatched turn that fails again finalizes as a
 *     normal error — no chain-walking.
 *
 * State machine per local session id:
 *   (none) --beginHandoff (route intake; no-clobber)--> deciding
 *   deciding --session.error--> deciding{deferredError}     [bridge defers]
 *   deciding --decideHandoff--> redispatched ('proceed', single-flight:
 *       only the FIRST transition wins; duplicate exhausted reports from the
 *       engine's retry loop get 'stale' and do nothing)
 *   redispatched --session.error--> (none)  [retry failed → finalize normally]
 *   any --retainTurn(new user turn)--> (none)
 *   redispatched/(none) --clearTurn(session.idle)--> (none)
 *
 * ponytail: module-level Maps, single-process state — matches the existing
 * pendingText/opencodeSessionMap posture; a bridge restart simply loses the
 * in-flight retry (same as the pre-#930 dead turn), never corrupts anything.
 */
import { logger } from '../utils/logger';
import { opencodeClient } from './opencode_engine';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';

export interface RetainedTurn {
  sdkSessionId: string;
  /** Fully-composed prompt text (incl. transient skill/memory prefaces). */
  data: string;
  parts?: Array<Record<string, unknown>>;
  cwd?: string;
  sdkOpts?: Record<string, unknown>;
  /** SDK id of the turn's user message — the revert target. Set by the bridge. */
  userMessageId?: string;
}

interface HandoffState {
  phase: 'deciding' | 'redispatched';
  providerID?: string;
  modelID?: string;
  /** Original turn's error message, held while a handoff is in flight. */
  deferredError?: string;
}

// ponytail: bounded FIFO — one composed prompt per live session is tiny; 200
// covers far more concurrent sessions than a single local server ever runs.
const MAX_RETAINED = 200;
const retained = new Map<string, RetainedTurn>();
const handoffs = new Map<string, HandoffState>();

/** ws_gateway: retain the composed turn right before promptAsync. */
export function retainTurn(
  localSessionId: string,
  turn: Omit<RetainedTurn, 'userMessageId'>,
): void {
  // A new user turn supersedes any stale handoff state from a prior turn.
  handoffs.delete(localSessionId);
  if (!retained.has(localSessionId) && retained.size >= MAX_RETAINED) {
    const oldest = retained.keys().next().value;
    if (oldest !== undefined) retained.delete(oldest);
  }
  retained.set(localSessionId, { ...turn });
}

/** Bridge (message.updated, role user): record the revert target for the turn. */
export function noteUserMessage(localSessionId: string, sdkMessageId: string): void {
  const turn = retained.get(localSessionId);
  if (turn) turn.userMessageId = sdkMessageId;
}

/**
 * Bridge (session.idle): turn completed — drop the buffer and handoff state.
 * Skipped while the route is still deciding: the engine can emit an idle
 * mid-decision, which would otherwise wipe the retained turn before the
 * re-dispatch reads it.
 */
export function clearTurn(localSessionId: string): void {
  const st = handoffs.get(localSessionId);
  if (st && st.phase === 'deciding') return;
  retained.delete(localSessionId);
  handoffs.delete(localSessionId);
}

/**
 * Route intake: mark the handoff in flight BEFORE any await (closes the race
 * with a fast session.error). No-clobber: the engine's retry loop can fire
 * DUPLICATE exhausted reports for the same spinning turn — the first one owns
 * the state machine.
 */
export function beginHandoff(localSessionId: string): void {
  if (!handoffs.has(localSessionId)) {
    handoffs.set(localSessionId, { phase: 'deciding' });
  }
}

export type SessionErrorAction = 'defer' | 'finalize';

/**
 * Bridge (session.error): what to do with this error given the handoff state.
 *  - 'defer': the spillover route is deciding — hold the message (it becomes
 *    the finalization message if the handoff fails) and skip finalizing.
 *  - 'finalize': no handoff in flight, or the RETRY itself failed
 *    (at-most-once) — run the normal error finalization.
 */
export function onSessionError(localSessionId: string, message: string): SessionErrorAction {
  const st = handoffs.get(localSessionId);
  if (!st) return 'finalize';
  if (st.phase === 'deciding') {
    st.deferredError = message;
    return 'defer';
  }
  // 'redispatched' — the retry failed too. At-most-once: finalize normally.
  handoffs.delete(localSessionId);
  return 'finalize';
}

export type DecideResult = 'proceed' | 'stale';

/**
 * Route: record the resolved handoff decision. Returns 'proceed' exactly once
 * per handoff (the 'deciding' → 'redispatched' transition is the single-flight
 * gate — duplicate exhausted reports and cleared/absent state get 'stale').
 * On 'proceed' the caller MUST invoke redispatchTurn().
 */
export function decideHandoff(
  localSessionId: string,
  providerID: string,
  modelID: string,
): DecideResult {
  const st = handoffs.get(localSessionId);
  if (!st || st.phase !== 'deciding') return 'stale';
  st.phase = 'redispatched';
  st.providerID = providerID;
  st.modelID = modelID;
  return 'proceed';
}

/**
 * Route: no cross-provider tier resolved (or resolution threw). Clears the
 * handoff state and returns the deferred error message (if the bridge deferred
 * one) so the caller can finalize it — otherwise the session would hang.
 */
export function failHandoff(localSessionId: string): string | undefined {
  const st = handoffs.get(localSessionId);
  handoffs.delete(localSessionId);
  return st?.deferredError;
}

/** Injectable engine/DB boundary so the re-dispatch path is unit-testable. */
export interface RedispatchDeps {
  /** Abort the spinning turn (kills the engine's endless rate-limit retry loop). */
  abort: (sdkSessionId: string, cwd?: string) => Promise<unknown>;
  revert: (sdkSessionId: string, messageId: string) => Promise<unknown>;
  prompt: (
    sdkSessionId: string,
    data: string,
    model: { providerID: string; modelID: string },
    cwd?: string,
    opts?: Record<string, unknown>,
    parts?: Array<Record<string, unknown>>,
  ) => Promise<boolean>;
  clearError: (localSessionId: string) => void;
  setError: (localSessionId: string, message: string) => void;
}

/**
 * Finalize a session as errored outside the bridge's session.error handler
 * (deferred-error fallback). Mirrors the bridge's finalize essentials:
 * status='error' + error broadcast + session.updated broadcast.
 */
export function finalizeErrorStatus(localSessionId: string, message: string): void {
  try {
    const repo = new AgentSessionsRepository();
    repo.setErrorStatus(localSessionId, message);
    // Dynamic import breaks the ws_gateway → turn_redispatch → ws_gateway
    // static cycle (same pattern ws_gateway uses for the stream bridge).
    void import('./ws_gateway')
      .then(({ broadcast, broadcastSessionUpdated }) => {
        broadcast({ v: 1, type: 'error', id: localSessionId, message });
        const updated = repo.findById(localSessionId);
        if (updated) broadcastSessionUpdated(updated);
      })
      .catch(() => {});
  } catch (err) {
    logger.error(`[TurnRedispatch] finalizeErrorStatus failed for ${localSessionId}:`, err);
  }
}

function defaultDeps(): RedispatchDeps {
  return {
    abort: (sdkId, cwd) => opencodeClient.abortSession(sdkId, cwd),
    revert: (sdkId, messageId) => opencodeClient.revertSession(sdkId, messageId),
    prompt: (sdkId, data, model, cwd, opts, parts) =>
      (opencodeClient.promptAsync as unknown as (
        id: string,
        data: string,
        model?: { providerID: string; modelID: string },
        cwd?: string,
        opts?: Record<string, unknown>,
        parts?: Array<Record<string, unknown>>,
      ) => Promise<boolean>).call(opencodeClient, sdkId, data, model, cwd, opts, parts),
    clearError: (localSessionId) => {
      try {
        new AgentSessionsRepository().clearErrorStatus(localSessionId);
      } catch {
        /* no-op when not in error */
      }
    },
    setError: finalizeErrorStatus,
  };
}

/**
 * Perform the mid-run re-dispatch: abort the spinning turn, revert it in the
 * SAME engine session, then re-prompt the retained composed turn on the new
 * provider. Failure handling:
 *  - No retained turn at all → the exhaustion report has no in-flight
 *    interactive turn behind it (idle-time report, or a non-ws_gateway turn,
 *    e.g. AgentRunner). BENIGN no-op: clear state, never touch the session.
 *  - Retained turn but no revert target / engine rejection → the turn is
 *    genuinely stuck; abort it and finalize with the ORIGINAL deferred error
 *    so the session is never left hanging. Never retried again (at-most-once).
 * Never throws.
 */
export async function redispatchTurn(
  localSessionId: string,
  deps?: Partial<RedispatchDeps>,
): Promise<boolean> {
  // Snapshot state synchronously — a racing session.idle may clearTurn() once
  // we hit the first await.
  const st = handoffs.get(localSessionId);
  const turn = retained.get(localSessionId);
  const d = { ...defaultDeps(), ...(deps ?? {}) };
  const failMessage =
    st?.deferredError ??
    'Provider rate-limited; cross-provider fallback re-dispatch failed';

  if (!turn) {
    // ponytail: no retained turn = nothing in flight to resume (idle-time
    // report, or an AgentRunner turn that never goes through ws_gateway —
    // that path keeps the pre-#930 behavior: next-turn pickup only).
    handoffs.delete(localSessionId);
    logger.info(
      `[TurnRedispatch] session ${localSessionId}: no retained in-flight turn — handoff persisted for next turn only`,
    );
    return false;
  }

  if (!st || st.phase !== 'redispatched' || !st.providerID || !st.modelID || !turn.userMessageId) {
    handoffs.delete(localSessionId);
    logger.warn(
      `[TurnRedispatch] session ${localSessionId}: in-flight turn cannot be re-dispatched (missing revert target/decision) — aborting + finalizing as error`,
    );
    try {
      await d.abort(turn.sdkSessionId, turn.cwd);
    } catch {
      /* best effort — the turn may already be dead */
    }
    d.setError(localSessionId, failMessage);
    return false;
  }

  const { providerID, modelID } = st;
  try {
    // Error-first ordering: the bridge may have finalized status='error'
    // before the route intake ran. No-op otherwise.
    d.clearError(localSessionId);
    // Kill the engine's endless rate-limit retry loop for the failed turn —
    // without this the session spins in 'working' forever (session.error
    // never fires for a sustained 429; see module docs).
    await d.abort(turn.sdkSessionId, turn.cwd);
    // Discard the failed partial turn engine-side (user message + partial
    // assistant output), then resume the SAME session on the new provider.
    await d.revert(turn.sdkSessionId, turn.userMessageId);
    const ok = await d.prompt(
      turn.sdkSessionId,
      turn.data,
      { providerID, modelID },
      turn.cwd,
      turn.sdkOpts,
      turn.parts,
    );
    if (!ok) throw new Error('promptAsync declined the re-dispatch');
    logger.info(
      `[TurnRedispatch] session ${localSessionId}: re-dispatched interrupted turn on ${providerID}/${modelID} (same engine session ${turn.sdkSessionId})`,
    );
    return true;
  } catch (err) {
    logger.error(
      `[TurnRedispatch] session ${localSessionId}: re-dispatch failed — finalizing original error:`,
      err,
    );
    handoffs.delete(localSessionId);
    d.setError(localSessionId, failMessage);
    return false;
  }
}

/** Test-only: wipe module state between unit tests. */
export function _resetForTests(): void {
  retained.clear();
  handoffs.clear();
}
