import { dirname, join } from 'path';
import { decisionSettingsPath } from './decision_settings';
import { adaptRouterFreeConfig } from './router_free_config';
import { determineFreeMode, type FreeAccountCapacity, type FreeClassification, type FreeTier, type PrivacyState } from './router_free_policy';
import { RouterFreeStateStore, type OwnedFreeQueueDescriptor } from './router_free_state';
import type { GridAccount } from './router_grid_select';
import type { GridClassificationResult } from './router_grid_classifier';
import type { RouterGridConfig } from './router_grid_config';

/**
 * Free Mode runtime (F1 hold/queue, F2 release, F3 verifier gate). It never calls a free model:
 * with no task-specific verifier, the only legal Free behaviour is to hold work for paid capacity.
 */
export const FREE_HOLD_MESSAGE = 'Paid model capacity is exhausted. This request was not sent; it is held until paid capacity returns.';
export const FREE_RELEASE_MESSAGE = 'Paid model capacity is back. Send your held request again to continue.';
export interface FreeHold { reason: 'free_mode_queued' | 'router_state_unavailable'; message: string; durable: boolean }

export function routerFreeStatePath(): string { return join(dirname(decisionSettingsPath()), 'router-free-state.json'); }
let cached: { path: string; store: RouterFreeStateStore } | null = null;
export function freeStore(config: RouterGridConfig, path = routerFreeStatePath()): RouterFreeStateStore {
  // ponytail: one API process owns the state file (see RouterFreeStateStore); per-path singleton.
  if (cached?.path !== path) cached = { path, store: new RouterFreeStateStore({ statePath: path, clock: Date.now, config: adaptRouterFreeConfig(config).state }) };
  return cached.store;
}
export function resetFreeStoreForTests(): void { cached = null; }
/** Fail-fast parse/read before any classifier or provider request. */
export function assertFreeRuntimeReady(config: RouterGridConfig): void { freeStore(config).queue(); }

/**
 * Local privacy preflight, run before anything Free. ponytail: Rhythm has no local private-data
 * detector, so nothing can be proven public and every task is 'unknown' (paid-only). Upgrade path:
 * a local inspector that can prove `false` for text and inspected attachments.
 */
export function freePrivacyPreflight(): PrivacyState { return 'unknown'; }

/**
 * Map grid accounts to policy capacity. A reset deadline is never positive capacity: an expired
 * exhaustion with no fresh known quota stays 'unknown', and only a fresh positive quota is recovery.
 */
export function freeCapacity(accounts: readonly GridAccount[], usageFresh: boolean, now: number): FreeAccountCapacity[] {
  return accounts.map(a => {
    const cooling = a.exhaustedUntil !== null && a.exhaustedUntil > now;
    const known = usageFresh && a.quotaRemainingPct !== null;
    const exhausted: boolean | 'unknown' = cooling || (known && a.quotaRemainingPct! <= 0) ? true : known ? false : 'unknown';
    return { id: a.id, provider: a.provider, exhausted, verified: cooling || known, fresh: cooling || usageFresh };
  });
}

export interface FreeModeState { enabled: boolean; active: boolean; recovered: boolean; trace: string[] }
export function checkFreeMode(input: {
  config: RouterGridConfig; accounts: readonly GridAccount[]; usageFresh: boolean; openrouterUsable: boolean;
  tier: FreeTier; now: number; statePath?: string;
}): FreeModeState {
  const f = input.config.free_mode;
  if (f.enabled !== true) return { enabled: false, active: false, recovered: false, trace: ['disabled'] };
  const wasActive = freeStore(input.config, input.statePath).queue().length > 0;
  const decision = determineFreeMode({
    config: adaptRouterFreeConfig(input.config).policy, accounts: freeCapacity(input.accounts, input.usageFresh, input.now),
    // Budget 0 means no paid OpenRouter spending, so it can never stand in for subscription capacity.
    paidOpenrouter: f.paid_openrouter_budget_usd > 0 && input.openrouterUsable ? 'available' : 'unavailable',
    wasActive, tier: input.tier, resetCrossed: false,
  });
  return { enabled: true, active: decision.active, recovered: wasActive && !decision.active, trace: decision.trace };
}

/** F1: durable, body-free descriptor; the caller must not dispatch. Never calls any model. */
export function holdForFreeMode(input: {
  config: RouterGridConfig; taskId: string; ownerUserId: number | null; reference: string;
  classification: Pick<GridClassificationResult, 'tier' | 'category' | 'canQueue'>; now: number; statePath?: string;
}): FreeHold {
  const classification: FreeClassification = { tier: input.classification.tier, category: input.classification.category,
    canQueue: input.classification.canQueue, containsPrivateData: freePrivacyPreflight() };
  const queued = freeStore(input.config, input.statePath).enqueue({ taskId: input.taskId, ownerUserId: String(input.ownerUserId ?? 'system'),
    reference: input.reference, enqueuedAt: input.now, classification });
  // A full queue still holds: the request is refused rather than sent anywhere.
  return { reason: 'free_mode_queued', message: FREE_HOLD_MESSAGE, durable: queued.kind === 'queued' || queued.reason === 'already_queued' };
}

export interface FreeReleaseDeps {
  /** Current owner, or undefined when the session/task is gone, archived, closed or disabled. */
  currentOwner(reference: string): Promise<number | null | undefined>;
  /** Drain (session) or re-run (scheduled) the released reference through existing paths. */
  release(reference: string, descriptor: OwnedFreeQueueDescriptor): Promise<void>;
}
/**
 * F2: called only after checkFreeMode reports verified recovery (fresh positive paid capacity).
 * Tier 1 first, then oldest. Descriptors whose owner changed or whose target is gone are dropped; others are
 * handed to deps.release (held-turn drain or scheduled re-run). Nothing partly executed is ever replayed.
 */
export async function releaseFreeQueue(config: RouterGridConfig, deps: FreeReleaseDeps, statePath?: string): Promise<{ released: string[]; dropped: string[] }> {
  const store = freeStore(config, statePath);
  const released: string[] = [], dropped: string[] = [];
  for (const descriptor of store.queue()) {
    if (!store.take(descriptor.taskId, descriptor.ownerUserId)) continue;
    const owner = await deps.currentOwner(descriptor.reference).catch(() => undefined);
    if (owner === undefined || String(owner ?? 'system') !== descriptor.ownerUserId) { dropped.push(descriptor.taskId); continue; }
    await deps.release(descriptor.reference, descriptor).catch(() => undefined);
    released.push(descriptor.taskId);
  }
  return { released, dropped };
}

// F3 (verifier registry, public-context preflight, Free extraction executor): router_free_extraction.ts.
