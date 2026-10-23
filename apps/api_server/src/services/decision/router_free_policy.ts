import defaults from './router_grid.default.json';
/** Pure descriptors only: a route is NOT permission to publish an unverified result. */
export type FreeTier = 1 | 2 | 3 | 4;
export type FreeCategory = 'coding' | 'knowledge' | 'design';
export type PrivacyState = boolean | 'unknown';
export interface FreeClassification {
  tier: FreeTier;
  category: FreeCategory;
  canQueue: boolean;
  containsPrivateData: PrivacyState;
}
export interface FreeCandidate { model: string; effort?: string }
export interface FreeImageHelper extends FreeCandidate { prompt: string }
export interface FreeModeConfig {
  enabled?: boolean;
  skip_paid_openrouter?: boolean;
  use_free_for_tier4?: boolean;
  reserve_pct?: number;
  rpm_limit?: number;
  daily_request_limit?: number;
  ling_verified_free?: boolean;
  grid: Readonly<Record<FreeCategory, Readonly<Record<FreeTier, readonly FreeCandidate[]>>>>;
  optionalLing?: string | FreeCandidate;
  textOnly: readonly string[];
  imageHelper: FreeImageHelper;
  probation: readonly string[];
  forbiddenReal: readonly string[];
  randomFallback: string | FreeCandidate;
}
export const FREE_MODE_DEFAULTS = Object.freeze({
  enabled: defaults.free_mode.enabled, skip_paid_openrouter: defaults.free_mode.skip_paid_openrouter,
  use_free_for_tier4: defaults.free_mode.use_free_for_tier4,
  reserve_pct: defaults.free_mode.daily_reserve_pct, rpm_limit: defaults.free_mode.rpm_limit,
  daily_request_limit: defaults.free_mode.daily_request_limit, ling_verified_free: defaults.free_mode.ling_verified_free,
});
export interface FreeAccountCapacity {
  id: string;
  provider: 'anthropic' | 'openai';
  exhausted: boolean | 'unknown';
  verified: boolean;
  fresh: boolean;
}
export interface DetermineFreeModeInput {
  config: FreeModeConfig;
  accounts: readonly FreeAccountCapacity[];
  paidOpenrouter: 'available' | 'unavailable' | 'unknown';
  /** Explicit freshness proof for paid recovery; a cached available flag alone cannot exit. */
  paidRecovery?: { available: boolean; verified: boolean; fresh: boolean };
  wasActive: boolean;
  tier: FreeTier;
  resetCrossed: boolean;
}
export interface FreeModeDecision { active: boolean; refreshRequired: boolean; trace: string[] }
export function determineFreeMode(input: DetermineFreeModeInput): FreeModeDecision {
  const { config, accounts } = input;
  const result = (active: boolean, reason: string): FreeModeDecision => ({
    active, refreshRequired: input.resetCrossed, trace: [reason],
  });
  if (config.enabled !== true) return result(false, 'disabled');
  if (input.tier === 4 && config.use_free_for_tier4 === true) return result(true, 'tier4_opt_in');
  const recovered = accounts.some(a => a.exhausted === false && a.verified && a.fresh)
    || (config.skip_paid_openrouter !== true && input.paidRecovery?.available === true
      && input.paidRecovery.verified && input.paidRecovery.fresh);
  if (input.wasActive) return result(!recovered, recovered ? 'verified_recovery' : 'awaiting_verified_recovery');
  const allExhausted = accounts.length === 4
    && new Set(accounts.map(a => a.id)).size === 4
    && accounts.filter(a => a.provider === 'anthropic').length === 2
    && accounts.filter(a => a.provider === 'openai').length === 2
    && accounts.every(a => typeof a.id === 'string' && a.id.trim().length > 0
      && a.exhausted === true && a.verified === true && a.fresh === true);
  const paidUnavailable = config.skip_paid_openrouter === true || input.paidOpenrouter === 'unavailable';
  return result(allExhausted && paidUnavailable, allExhausted && paidUnavailable ? 'capacity_exhausted' : 'capacity_not_proven_exhausted');
}

export interface SelectFreeRouteInput {
  config: FreeModeConfig;
  classification: FreeClassification;
  /** Must be established locally BEFORE any free classification, helper, answer or shadow. */
  privacyPreflight: PrivacyState;
  realUser: boolean;
  hasImages: boolean;
  canVerify: boolean;
  availableVerifiedFreeModels: ReadonlySet<string>;
  openCircuitModels: ReadonlySet<string>;
  dailyRemaining: number;
  dailyCount: number;
  rpmCount: number;
}
export type FreeRouteDecision = {
  kind: 'route'; model: string; effort: string | undefined; degraded: boolean;
  helper: FreeImageHelper | null; requiredCalls: number; trace: string[];
} | { kind: 'queue'; reason: string; paidRequired: boolean; trace: string[] };

function candidate(value: string | FreeCandidate): FreeCandidate {
  return typeof value === 'string' ? { model: value } : value;
}

export function selectFreeRoute(input: SelectFreeRouteInput): FreeRouteDecision {
  const { config, classification: c } = input;
  // Trace only fixed reason codes, never prompts, bodies, config helper prompts or arbitrary ids.
  const trace: string[] = [];
  const queue = (reason: string, paidRequired = false): FreeRouteDecision => ({
    kind: 'queue', reason, paidRequired, trace: [...trace, reason],
  });
  if (input.privacyPreflight !== false || c.containsPrivateData !== false) return queue('privacy', true);
  if (config.enabled !== true) return queue('disabled', true);
  if (input.canVerify !== true) return queue('verification_unavailable', true);
  const dailyLimit = config.daily_request_limit ?? FREE_MODE_DEFAULTS.daily_request_limit;
  const rpmLimit = config.rpm_limit ?? FREE_MODE_DEFAULTS.rpm_limit;
  const reserve = config.reserve_pct ?? FREE_MODE_DEFAULTS.reserve_pct;
  if (![dailyLimit, rpmLimit, reserve, input.dailyRemaining, input.dailyCount, input.rpmCount].every(Number.isFinite)
    || dailyLimit <= 0 || rpmLimit <= 0 || reserve < 0 || reserve > 100
    || input.dailyCount < 0 || input.rpmCount < 0) return queue('invalid_budget');
  const remaining = Math.min(input.dailyRemaining, dailyLimit - input.dailyCount);
  if (remaining <= 0) return queue('daily_budget');
  if (remaining <= dailyLimit * reserve / 100 && c.tier !== 2) return queue('daily_reserve', c.tier === 1);
  if (c.tier === 1 && c.canQueue) return queue('tier1_paid_priority', true);

  const ling = config.optionalLing === undefined ? undefined : candidate(config.optionalLing);
  const randomFallback = candidate(config.randomFallback);
  const eligible = (model: string): boolean => {
    if (input.realUser && config.forbiddenReal.includes(model)) { trace.push('forbidden_real'); return false; }
    if (config.probation.includes(model)) { trace.push('probation'); return false; }
    if (ling?.model === model && model !== randomFallback.model && config.ling_verified_free !== true) { trace.push('ling_unverified'); return false; }
    if (!input.availableVerifiedFreeModels.has(model)) { trace.push('not_verified_free'); return false; }
    if (input.openCircuitModels.has(model)) { trace.push('circuit_open'); return false; }
    return true;
  };
  const ordered = [...(config.grid[c.category]?.[c.tier] ?? [])];
  if (ling && config.ling_verified_free === true && c.category === 'knowledge' && c.tier <= 3) ordered.unshift(ling);
  // ponytail: reserve one classifier + answer + verifier; no retry or execution state in this module.
  const attempts = [...ordered.filter(pick => pick.model !== randomFallback.model).map(pick => ({ pick, random: false })),
    { pick: randomFallback, random: true }];
  for (const { pick, random } of attempts) {
    if (!eligible(pick.model)) continue;
    const needsHelper = input.hasImages && config.textOnly.includes(pick.model);
    if (needsHelper && !eligible(config.imageHelper.model)) { trace.push('helper_unavailable'); continue; }
    const requiredCalls = 3 + Number(needsHelper);
    if (remaining < requiredCalls) return queue('daily_budget');
    if (rpmLimit - input.rpmCount < requiredCalls) return queue('rpm_budget');
    return {
      kind: 'route', model: pick.model, effort: pick.effort, degraded: c.tier === 1 || random,
      helper: needsHelper ? { model: config.imageHelper.model, prompt: config.imageHelper.prompt, effort: config.imageHelper.effort } : null,
      requiredCalls, trace: [...trace, needsHelper ? 'helper_then_answer' : 'answer', 'verification_required', random ? 'random_degraded' : 'grid_selected'],
    };
  }
  return queue('no_available_model');
}

export interface FreeQueueDescriptor {
  taskId: string;
  /** Legacy pure sorting callers may omit it; persistent queue admission requires it. */
  ownerUserId?: string;
  classification: FreeClassification;
  reference: string;
  enqueuedAt: number;
}
export function sortFreeQueue(queue: readonly FreeQueueDescriptor[]): FreeQueueDescriptor[] {
  return queue.map(item => ({
    taskId: item.taskId, reference: item.reference, enqueuedAt: item.enqueuedAt,
    ...(item.ownerUserId === undefined ? {} : { ownerUserId: item.ownerUserId }),
    classification: {
      tier: item.classification.tier, category: item.classification.category,
      canQueue: item.classification.canQueue, containsPrivateData: item.classification.containsPrivateData,
    },
  })).sort((a, b) => Number(b.classification.tier === 1) - Number(a.classification.tier === 1)
    || a.enqueuedAt - b.enqueuedAt);
}
