import defaults from './router_grid.default.json';
import type { RouterGridConfig, GridCategory, GridTier } from './router_grid_config';
import type { FreeCandidate, FreeModeConfig, FreeImageHelper } from './router_free_policy';
import type { RouterFreeLimits } from './router_free_state';

export interface ConfigFreeCandidate extends FreeCandidate {
  thinking?: true;
  condition?: 'extraction_or_formatting_only';
}
export interface FreeClassifierStep extends ConfigFreeCandidate {
  kind: 'paid_decisions_api' | 'paid_model' | 'free_model' | 'rules';
  model: string;
  tier?: GridTier;
  requires_public_preflight?: true;
}
export interface RouterFreeConfig {
  enabled: boolean; skip_paid_openrouter: boolean; use_free_for_tier4: boolean;
  ling_verified_free: boolean; shadow_test: boolean;
  rpm_limit: number; daily_request_limit: number; daily_reserve_pct: number;
  /** 0 means no paid fallback spending until an operator explicitly sets a budget. */
  paid_openrouter_budget_usd: number;
  daily_reset_hour_utc: number; daily_reset_minute_utc: number;
  breaker_failures: number; failure_window_ms: number; breaker_open_ms: number;
  retry_delay_ms: number; max_queue_entries: number;
  shadow_sampling_denominator: number; promotion_min_results: number;
  effort_support: Record<string, string[]>; thinking_support: Record<string, true>;
  grid: Record<GridCategory, Record<GridTier, ConfigFreeCandidate[]>>;
  text_only: string[]; image_helper: FreeImageHelper; optional_ling: ConfigFreeCandidate;
  probation: string[]; forbidden_real: string[]; random_fallback: ConfigFreeCandidate;
  classifier_free_start_index: number;
  classifier_chain: (Omit<FreeClassifierStep, 'model'> & { model?: string })[];
}
const base = defaults.free_mode;
const categories = ['coding', 'knowledge', 'design'] as const;
const tiers = ['1', '2', '3', '4'];
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
  && [Object.prototype, null].includes(Object.getPrototypeOf(v));
function valid(ok: unknown): asserts ok { if (!ok) throw new Error('invalid_router_free_config'); }
function keys(value: unknown, allowed: readonly string[]): asserts value is Record<string, any> {
  valid(object(value) && Object.keys(value).every(k => allowed.includes(k)));
}
const count = (v: unknown, min: number, max = Number.MAX_SAFE_INTEGER): boolean =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max;
const knownModels = new Set([
  ...Object.values(base.grid).flatMap(category => Object.values(category).flat().map(c => c.model)),
  ...base.text_only, base.image_helper.model, base.optional_ling.model, ...base.probation,
  ...base.forbidden_real, base.random_fallback.model,
]);
const supported = base.effort_support as Record<string, string[]>;
const thinking = base.thinking_support as Record<string, boolean>;
const conditioned = Object.values(base.grid).flatMap(category => Object.values(category).flat())
  .filter(c => 'condition' in c).map(c => c.model);

/** Closed settings schema. Membership is NOT evidence of free pricing/availability. */
export function validateRouterFreeConfig(value: unknown): asserts value is RouterFreeConfig {
  keys(value, Object.keys(base));
  for (const k of ['enabled', 'skip_paid_openrouter', 'use_free_for_tier4', 'ling_verified_free', 'shadow_test'])
    valid(typeof value[k] === 'boolean');
  for (const k of ['rpm_limit', 'daily_request_limit', 'breaker_failures', 'failure_window_ms', 'breaker_open_ms',
    'retry_delay_ms', 'max_queue_entries', 'shadow_sampling_denominator', 'promotion_min_results']) valid(count(value[k], 1));
  valid(count(value.daily_reset_hour_utc, 0, 23) && count(value.daily_reset_minute_utc, 0, 59));
  valid(typeof value.daily_reserve_pct === 'number' && Number.isFinite(value.daily_reserve_pct)
    && value.daily_reserve_pct >= 0 && value.daily_reserve_pct <= 100);
  valid(typeof value.paid_openrouter_budget_usd === 'number' && Number.isFinite(value.paid_openrouter_budget_usd)
    && value.paid_openrouter_budget_usd >= 0);
  keys(value.effort_support, Object.keys(supported));
  for (const [model, efforts] of Object.entries(value.effort_support)) valid(Array.isArray(efforts) && efforts.length > 0
    && new Set(efforts).size === efforts.length && efforts.every(e => supported[model].includes(e)));
  keys(value.thinking_support, Object.keys(thinking));
  valid(Object.values(value.thinking_support).every(v => v === true));
  const effortSupport = value.effort_support;
  const thinkingSupport = value.thinking_support;
  function candidate(c: unknown, allowedKeys = ['model', 'effort', 'thinking', 'condition']): asserts c is ConfigFreeCandidate & Record<string, any> {
    keys(c, allowedKeys);
    valid(typeof c.model === 'string' && knownModels.has(c.model));
    if (c.effort !== undefined) valid(typeof c.effort === 'string' && effortSupport[c.model]?.includes(c.effort));
    if (c.thinking !== undefined) valid(c.thinking === true && thinkingSupport[c.model] === true);
    // Keep scoped metadata mandatory: dropping it must not broaden a limited model's use.
    valid(!conditioned.includes(c.model) || c.condition === 'extraction_or_formatting_only');
    valid(c.condition === undefined || (conditioned.includes(c.model) && c.condition === 'extraction_or_formatting_only'));
    valid(!thinking[c.model] || c.thinking === true);
  }
  keys(value.grid, categories);
  for (const category of categories) {
    keys(value.grid[category], tiers);
    for (const tier of tiers) {
      const list = value.grid[category][tier];
      valid(Array.isArray(list) && list.length > 0 && list.length <= knownModels.size);
      for (const c of list) {
        candidate(c);
        valid(c.model !== base.optional_ling.model); // Ling is inserted by the guarded policy only.
        valid(!c.condition || (category === 'knowledge' && tier === '4'));
      }
      valid(new Set(list.map(c => c.model)).size === list.length);
    }
  }
  for (const k of ['text_only', 'probation', 'forbidden_real']) {
    const list = value[k];
    valid(Array.isArray(list) && new Set(list).size === list.length && list.every(id => typeof id === 'string' && knownModels.has(id)));
    // Safety lists cannot be weakened by an override.
    valid((base[k as 'text_only' | 'probation' | 'forbidden_real']).every(id => list.includes(id)));
  }
  candidate(value.image_helper, ['model', 'prompt', 'effort']);
  valid(value.image_helper.model === base.image_helper.model && typeof value.image_helper.prompt === 'string'
    && value.image_helper.prompt.trim().length > 0);
  candidate(value.optional_ling);
  valid(value.optional_ling.model === base.optional_ling.model);
  candidate(value.random_fallback);
  valid(value.random_fallback.model === base.random_fallback.model);
  valid(value.classifier_free_start_index === base.classifier_free_start_index);
  valid(Array.isArray(value.classifier_chain) && value.classifier_chain.length === base.classifier_chain.length);
  for (const [i, step] of value.classifier_chain.entries()) {
    const approved = base.classifier_chain[i];
    keys(step, Object.keys(approved));
    // Approved descriptors only; no execution or arbitrary free-price inference here.
    valid(JSON.stringify(Object.fromEntries(Object.keys(approved).map(k => [k, step[k]]))) === JSON.stringify(approved));
  }
}

/** Pure adapter only: caller owns verification, LFM condition/thinking enforcement and execution. */
export function adaptRouterFreeConfig(config: RouterGridConfig): {
  policy: FreeModeConfig & { grid: RouterFreeConfig['grid'] }; state: RouterFreeLimits;
} {
  const f = config.free_mode;
  validateRouterFreeConfig(f);
  return {
    policy: structuredClone({ enabled: f.enabled, skip_paid_openrouter: f.skip_paid_openrouter,
      use_free_for_tier4: f.use_free_for_tier4, ling_verified_free: f.ling_verified_free,
      reserve_pct: f.daily_reserve_pct, rpm_limit: f.rpm_limit, daily_request_limit: f.daily_request_limit,
      grid: f.grid, optionalLing: f.optional_ling, textOnly: f.text_only, imageHelper: f.image_helper,
      probation: f.probation, forbiddenReal: f.forbidden_real, randomFallback: f.random_fallback }),
    state: { rpm_limit: f.rpm_limit, daily_request_limit: f.daily_request_limit,
      daily_reset_hour_utc: f.daily_reset_hour_utc, daily_reset_minute_utc: f.daily_reset_minute_utc,
      breaker_failures: f.breaker_failures, failure_window_ms: f.failure_window_ms,
      breaker_open_ms: f.breaker_open_ms, retry_delay_ms: f.retry_delay_ms, queue_max_entries: f.max_queue_entries },
  };
}
