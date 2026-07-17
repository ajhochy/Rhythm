/**
 * #930 — mid-run cross-provider re-dispatch on account exhaustion.
 *
 * When the vendored anthropic plugin reports total account exhaustion mid-turn
 * (POST /opencode/spillover {exhausted:true}), the in-flight turn is NOT dead —
 * the Anthropic plugin can report account exhaustion before the engine's
 * bounded retry policy reaches `session.error`. The route then advances early;
 * other providers advance from the structured terminal `session.error` after
 * the engine's three retry attempts. Both drivers use this same state machine.
 *
 * Per AJ's decisions:
 *   - Resume the SAME engine session: abort the retry loop, revert the failed
 *     partial turn (opencodeClient.revertSession), re-prompt on the new tier.
 *   - Re-dispatch the FULL composed prompt (incl. the transient skill/memory
 *     prefaces) — ws_gateway retains it here per turn, cleared on normal
 *     completion.
 *   - Partial output of the interrupted turn is discarded (revert engine-side,
 *     pendingText dropped bridge-side).
 *   - Each configured tier is attempted at most once per retained turn. Only
 *     rate-limit/exhaustion errors walk further; all other errors finalize.
 *
 * State machine per local session id:
 *   (none) --beginHandoff (route intake; no-clobber)--> deciding
 *   deciding --session.error--> deciding{deferredError}     [bridge defers]
 *   active --beginHandoff(rate-limit)--> deciding
 *   deciding --decideHandoff--> redispatched ('proceed', single-flight:
 *       only the FIRST transition wins; duplicate exhausted reports from the
 *       engine's retry loop get 'stale' and do nothing)
 *   redispatched --prompt accepted--> active (new current tier)
 *   active --non-rate-limit session.error--> (none) [finalize normally]
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
import {
  classifyProviderError,
  formatFallbackExhaustedMessage,
  getConfiguredFallbackChain,
  resolveNextFallbackHandoff,
  type CrossProviderHandoffDecision,
} from './model_fallback';
import type { McpRoleConfig } from './agent_profile_scope';

export interface RetainedTurn {
  sdkSessionId: string;
  /** Fully-composed prompt text (incl. transient skill/memory prefaces). */
  data: string;
  parts?: Array<Record<string, unknown>>;
  cwd?: string;
  sdkOpts?: Record<string, unknown>;
  /** Model that currently owns this retained turn. */
  model?: { providerID: string; modelID: string };
  /** Original profile scope, re-expanded/prepared for every destination. */
  mcpRoleConfig?: McpRoleConfig | null;
  /** SDK id of the turn's user message — the revert target. Set by the bridge. */
  userMessageId?: string;
}

interface HandoffState {
  phase: 'active' | 'deciding' | 'redispatched';
  currentTierId?: string;
  currentProviderID?: string;
  currentModelID?: string;
  visitedTierIds: Set<string>;
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
  if (!retained.has(localSessionId) && retained.size >= MAX_RETAINED) {
    const oldest = retained.keys().next().value;
    if (oldest !== undefined) retained.delete(oldest);
  }
  retained.set(localSessionId, { ...turn });
  const providerID = turn.model?.providerID;
  const tier = providerID
    ? getConfiguredFallbackChain().find((candidate) => candidate.providerID === providerID)
    : undefined;
  handoffs.set(localSessionId, {
    phase: 'active',
    currentTierId: tier?.id,
    currentProviderID: providerID,
    currentModelID: turn.model?.modelID,
    visitedTierIds: new Set(tier ? [tier.id] : []),
  });
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
  if (st && st.phase !== 'active') return;
  retained.delete(localSessionId);
  handoffs.delete(localSessionId);
}

/**
 * Route intake: mark the handoff in flight BEFORE any await (closes the race
 * with a fast session.error). No-clobber: the engine's retry loop can fire
 * DUPLICATE exhausted reports for the same spinning turn — the first one owns
 * the state machine.
 */
export function beginHandoff(
  localSessionId: string,
  exhaustedProviderID?: string,
  message?: string,
): boolean {
  let st = handoffs.get(localSessionId);
  if (!st) {
    const turn = retained.get(localSessionId);
    let providerID = turn?.model?.providerID;
    let modelID = turn?.model?.modelID;
    if (!providerID) {
      try {
        const row = new AgentSessionsRepository().findById(localSessionId);
        providerID = row?.providerId ?? undefined;
        modelID = row?.modelId ?? undefined;
      } catch {
        /* DB may be unavailable in focused unit tests. */
      }
    }
    const tier = providerID
      ? getConfiguredFallbackChain().find((candidate) => candidate.providerID === providerID)
      : undefined;
    st = {
      phase: 'active',
      currentTierId: tier?.id,
      currentProviderID: providerID,
      currentModelID: modelID,
      visitedTierIds: new Set(tier ? [tier.id] : []),
    };
    handoffs.set(localSessionId, st);
  }
  if (st.phase !== 'active') return false;
  // Legacy/provider-less reports cannot identify whether they belong to the
  // current attempt. Once a destination is active, treat them as stale. Real
  // production drivers always supply/derive the exhausted current provider.
  if (!exhaustedProviderID && st.currentProviderID) return false;
  if (
    exhaustedProviderID &&
    st.currentProviderID &&
    st.currentProviderID !== exhaustedProviderID
  ) {
    return false;
  }

  const providerID = exhaustedProviderID ?? st.currentProviderID;
  if (providerID) {
    const exhaustedTiers = getConfiguredFallbackChain().filter(
      (tier) => tier.providerID === providerID,
    );
    if (exhaustedTiers.length === 0) return false;
    for (const tier of exhaustedTiers) st.visitedTierIds.add(tier.id);
    // A provider-level exhaustion signal means every same-provider option is
    // spent. Anchor after its final tier (Team + Personal for Anthropic).
    st.currentTierId = exhaustedTiers.at(-1)?.id ?? st.currentTierId;
    st.currentProviderID = providerID;
  }
  st.phase = 'deciding';
  if (message) st.deferredError = message;
  return true;
}

export type SessionErrorAction = 'defer' | 'cascade' | 'finalize';

/**
 * Bridge (session.error): what to do with this structured provider error.
 *  - 'defer': the spillover route is deciding — hold the message (it becomes
 *    the finalization message if the handoff fails) and skip finalizing.
 *  - 'cascade': rate-limit/exhaustion on the active tier — advance again.
 *  - 'finalize': auth/schema/tool/other failure — unchanged normal behavior.
 */
export function onSessionError(
  localSessionId: string,
  message: string,
  errorInfo: unknown = message,
): SessionErrorAction {
  const st = handoffs.get(localSessionId);
  if (st?.phase === 'deciding') {
    st.deferredError = message;
    return 'defer';
  }

  if (classifyProviderError(errorInfo) === 'rate_limit' && retained.has(localSessionId)) {
    const providerID = st?.currentProviderID ?? retained.get(localSessionId)?.model?.providerID;
    if (beginHandoff(localSessionId, providerID, message)) return 'cascade';
    // A rate-limit event racing an already-started handoff belongs to the
    // interrupted attempt; never finalize it over the replacement prompt.
    return 'defer';
  }

  // Auth/schema/tool/other errors preserve the pre-cascade behavior.
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
  tierId?: string,
): DecideResult {
  const st = handoffs.get(localSessionId);
  if (!st || st.phase !== 'deciding') return 'stale';
  st.phase = 'redispatched';
  st.currentProviderID = providerID;
  st.currentModelID = modelID;
  st.currentTierId =
    tierId ??
    getConfiguredFallbackChain().find((tier) => tier.providerID === providerID)?.id;
  if (st.currentTierId) st.visitedTierIds.add(st.currentTierId);
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

export interface ProviderExhaustionSignal {
  providerID?: string;
  message?: string;
  fromAccountId?: string | null;
}

export interface FallbackCascadeDeps {
  listAuthedProviders: () => Promise<string[]>;
  persistDecision: (
    localSessionId: string,
    decision: CrossProviderHandoffDecision,
  ) => Promise<void> | void;
  notifyDecision: (
    localSessionId: string,
    decision: CrossProviderHandoffDecision,
    signal: ProviderExhaustionSignal,
  ) => Promise<void> | void;
  redispatch: (localSessionId: string) => Promise<boolean>;
}

export type FallbackCascadeResult =
  | { outcome: 'redispatched' | 'persisted'; decision: CrossProviderHandoffDecision }
  | { outcome: 'terminal'; error?: string }
  | { outcome: 'stale' };

function defaultCascadeDeps(): FallbackCascadeDeps {
  return {
    listAuthedProviders: () => opencodeClient.listAuthedProviders(),
    persistDecision: (localSessionId, decision) => {
      new AgentSessionsRepository().updateFields(localSessionId, {
        providerId: decision.providerID,
        modelId: decision.modelID,
      });
    },
    notifyDecision: async (localSessionId, decision, signal) => {
      const { broadcast, broadcastSessionUpdated } = await import('./ws_gateway');
      broadcast({
        v: 1,
        type: 'session.spillover',
        sessionId: localSessionId,
        fromAccountId: signal.fromAccountId ?? null,
        toAccountId: null,
        reason: 'rate_limit_cross_provider',
        toProvider: decision.providerID,
        toModel: decision.modelID,
        toTier: decision.tier.label,
      });
      const updated = new AgentSessionsRepository().findById(localSessionId);
      if (updated) broadcastSessionUpdated(updated);
    },
    redispatch: (localSessionId) => redispatchTurn(localSessionId),
  };
}

/** Advance one bounded, single-flight step of the current turn's cascade. */
export async function advanceFallbackCascade(
  localSessionId: string,
  signal: ProviderExhaustionSignal = {},
  deps?: Partial<FallbackCascadeDeps>,
): Promise<FallbackCascadeResult> {
  const hasRetainedTurn = retained.has(localSessionId);
  const existing = handoffs.get(localSessionId);
  if (existing?.phase !== 'deciding') {
    if (!beginHandoff(localSessionId, signal.providerID, signal.message)) {
      return { outcome: 'stale' };
    }
  } else if (signal.message && !existing.deferredError) {
    existing.deferredError = signal.message;
  }

  const st = handoffs.get(localSessionId);
  if (!st || st.phase !== 'deciding') return { outcome: 'stale' };
  const d = { ...defaultCascadeDeps(), ...(deps ?? {}) };

  try {
    const authed = await d.listAuthedProviders();
    if (handoffs.get(localSessionId) !== st || st.phase !== 'deciding') {
      return { outcome: 'stale' };
    }
    const decision = resolveNextFallbackHandoff(
      st.currentTierId,
      authed,
      [...st.visitedTierIds],
    );
    if (!decision) {
      const deferred = failHandoff(localSessionId);
      // #1108 — name the provider/model/account that was last attempted so
      // the user has an actionable lead, instead of only the raw upstream
      // error text (which rarely says WHICH account/tier was exhausted).
      const exhausted = formatFallbackExhaustedMessage(
        st.currentProviderID,
        st.currentModelID,
        signal.fromAccountId,
      );
      const error = deferred ? `${deferred} — ${exhausted}` : exhausted;
      return { outcome: 'terminal', ...(hasRetainedTurn ? { error } : {}) };
    }
    if (
      decideHandoff(
        localSessionId,
        decision.providerID,
        decision.modelID,
        decision.tier.id,
      ) !== 'proceed'
    ) {
      return { outcome: 'stale' };
    }

    await d.persistDecision(localSessionId, decision);
    try {
      await d.notifyDecision(localSessionId, decision, signal);
    } catch (err) {
      logger.warn(`[TurnRedispatch] fallback notification failed for ${localSessionId}: ${String(err)}`);
    }
    const resumed = await d.redispatch(localSessionId);
    return { outcome: resumed ? 'redispatched' : 'persisted', decision };
  } catch (err) {
    logger.error(`[TurnRedispatch] fallback cascade failed for ${localSessionId}:`, err);
    const error = failHandoff(localSessionId);
    return { outcome: 'terminal', ...(hasRetainedTurn && error ? { error } : {}) };
  }
}

/** Injectable engine/DB boundary so the re-dispatch path is unit-testable. */
export interface RedispatchDeps {
  /** Abort the current provider attempt before replacing it. */
  abort: (sdkSessionId: string, cwd?: string) => Promise<unknown>;
  revert: (sdkSessionId: string, messageId: string) => Promise<unknown>;
  prepare: (
    sdkSessionId: string,
    mcpRoleConfig: McpRoleConfig | null,
    providerID: string,
  ) => Promise<boolean>;
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
    prepare: (sdkId, mcpRoleConfig, providerID) =>
      opencodeClient.updateSessionAllowlist(sdkId, mcpRoleConfig, providerID),
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

  if (
    !st ||
    st.phase !== 'redispatched' ||
    !st.currentProviderID ||
    !st.currentModelID ||
    !turn.userMessageId
  ) {
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

  const providerID = st.currentProviderID;
  const modelID = st.currentModelID;
  try {
    // Error-first ordering: the bridge may have finalized status='error'
    // before the route intake ran. No-op otherwise.
    d.clearError(localSessionId);
    // Stop the current provider attempt before replacing it. Anthropic's
    // account-exhaustion POST can arrive before the engine's retry cap.
    await d.abort(turn.sdkSessionId, turn.cwd);
    // Discard the failed partial turn engine-side (user message + partial
    // assistant output), then resume the SAME session on the new provider.
    await d.revert(turn.sdkSessionId, turn.userMessageId);
    // Re-run provider-aware preparation on every cold handoff. In particular,
    // google applies Gemini's scoped cap (or unscoped deferred allowlist)
    // before promptAsync can assemble its function declarations.
    const prepared = await d.prepare(
      turn.sdkSessionId,
      turn.mcpRoleConfig ?? null,
      providerID,
    );
    if (!prepared) throw new Error(`session preparation failed for ${providerID}`);
    const ok = await d.prompt(
      turn.sdkSessionId,
      turn.data,
      { providerID, modelID },
      turn.cwd,
      turn.sdkOpts,
      turn.parts,
    );
    if (!ok) throw new Error('promptAsync declined the re-dispatch');
    st.phase = 'active';
    turn.model = { providerID, modelID };
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
