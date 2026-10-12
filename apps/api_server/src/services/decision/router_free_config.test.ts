import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import defaults from './router_grid.default.json';
import { defaultRouterGridConfig, normaliseRouterGridConfig, loadRouterGridConfig } from './router_grid_config';
import { selectFreeRoute } from './router_free_policy';

const O = 'openrouter/';
const I = O + 'thinkingmachines/inkling:free', S = O + 'thinkingmachines/inkling-small:free';
const U = O + 'nvidia/nemotron-3-ultra-550b-a55b:free', N = O + 'nvidia/nemotron-3-super-120b-a12b:free';
const L = O + 'nvidia/nemotron-3.5-lightning:free', P = O + 'poolside/laguna-s-2.1:free';
const X = O + 'poolside/laguna-xs-2.1:free', C = O + 'cohere/north-mini-code:free', F = O + 'liquid/lfm-2.5-2.6b:free';
const pick = (model: string, effort?: string) => effort ? { model, effort } : { model };
const expected = {
  coding: { 1: [pick(S, 'max'), pick(I, 'max'), pick(U, 'high')],
    2: [pick(S, 'max'), pick(I, 'max'), pick(U, 'high'), { model: P, thinking: true }],
    3: [pick(S, 'medium'), { model: P, thinking: true }, pick(N, 'medium'), pick(C)], 4: [pick(L), pick(C), pick(X)] },
  knowledge: { 1: [pick(I, 'max'), pick(S, 'max')], 2: [pick(I, 'max'), pick(S, 'max'), pick(U, 'high')],
    3: [pick(U, 'medium'), pick(S, 'medium'), pick(N, 'medium')],
    4: [pick(L), pick(N, 'low'), { model: F, condition: 'extraction_or_formatting_only' }] },
  design: { 1: [pick(I, 'max')], 2: [pick(I, 'max'), pick(U, 'high'), pick(S, 'max')],
    3: [pick(S, 'high'), pick(U, 'medium')], 4: [pick(L), pick(N, 'low')] },
};
async function adapter() {
  const mod = await import('./router_free_config').catch(() => null);
  expect(mod, 'c01 config adapter must exist').not.toBeNull();
  return mod!;
}
describe('Free config-only acceptance contracts (no execution)', () => {
  it('c02 exact ordered grids retain thinking and the LFM condition', () => {
    expect((defaultRouterGridConfig() as any).free_mode?.grid).toEqual(expected);
  });
  it('c03 disabled numeric defaults and aliases are consumed by policy/state adapter', async () => {
    const a = (await adapter()).adaptRouterFreeConfig(defaultRouterGridConfig());
    expect(a.policy).toMatchObject({ enabled: false, skip_paid_openrouter: false, use_free_for_tier4: false,
      ling_verified_free: false, reserve_pct: 25, rpm_limit: 20, daily_request_limit: 50 });
    expect(a.state).toEqual({ rpm_limit: 20, daily_request_limit: 50, daily_reset_hour_utc: 0, daily_reset_minute_utc: 0,
      breaker_failures: 3, failure_window_ms: 600000, breaker_open_ms: 900000, retry_delay_ms: 60000, queue_max_entries: 1000 });
    expect(a.policy.grid).toEqual(expected);
    const c = normaliseRouterGridConfig({ free_mode: { daily_reserve_pct: 40, max_queue_entries: 7, rpm_limit: 9 } });
    expect((await adapter()).adaptRouterFreeConfig(c)).toMatchObject({ policy: { reserve_pct: 40, rpm_limit: 9 }, state: { queue_max_entries: 7, rpm_limit: 9 } });
  });
  it('c04 effort support, helper, exclusions, budget and classifier descriptors are explicit', () => {
    const f = (defaultRouterGridConfig() as any).free_mode;
    expect(f).toBeDefined();
    expect(f.effort_support).toEqual({ [I]: ['none', 'minimal', 'low', 'medium', 'high', 'max'], [S]: ['none', 'minimal', 'low', 'medium', 'high', 'max'], [U]: ['medium', 'high'], [N]: ['low', 'medium'] });
    expect(f.thinking_support).toEqual({ [P]: true });
    expect(f.text_only).toEqual([U, N, L, P, X, C, F]);
    expect(f.image_helper).toEqual({ model: O + 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', prompt: 'Describe this image in exhaustive detail for a model that cannot see it: layout, text content verbatim, colors, spacing, components, and any data shown.' });
    expect(f.optional_ling).toEqual({ model: O + 'inclusionai/ling-3.1-flash' });
    expect(f.probation).toEqual(['opencode/space-bunny-free', O + 'apodex/apodex-1.1-mini:free', O + 'dots-studio/dots-3-note-preview:free']);
    expect(f.forbidden_real).toEqual(['opencode/space-bunny-free']);
    expect(f.random_fallback).toEqual({ model: O + 'openrouter/free' });
    expect(f).toMatchObject({ shadow_test: false, paid_openrouter_budget_usd: 0, shadow_sampling_denominator: 20, promotion_min_results: 30 });
    expect(f.classifier_chain).toEqual([
      { kind: 'paid_decisions_api', model: 'gpt-6-luna' },
      { kind: 'paid_model', model: 'anthropic/claude-haiku-5-5', effort: 'low' },
      { kind: 'paid_model', model: O + 'xiaomi/mimo-v2.6-flash' },
      { kind: 'free_model', model: L, requires_public_preflight: true },
      { kind: 'free_model', model: S, effort: 'low', requires_public_preflight: true },
      { kind: 'rules', tier: 2 },
    ]);
    expect(f.classifier_free_start_index).toBe(3);
    expect(defaultRouterGridConfig().classifier.model).toBe('gpt-6-luna');
  });
  it.each([
    { enabled: 'true' }, { rpm_limit: -1 }, { daily_request_limit: NaN }, { breaker_failures: 0 },
    { retry_delay_ms: 1.5 }, { daily_reset_hour_utc: 24 }, { daily_reset_minute_utc: 60 },
    { daily_reserve_pct: 101 }, { paid_openrouter_budget_usd: -1 }, { max_queue_entries: 0 },
    { grid: { coding: { 5: [] } } }, { grid: { coding: { 2: [] } } }, { text_only: 'bad' },
    { grid: { coding: { 2: [{ model: 'missing' }] } } },
    { grid: { coding: { 2: [{ model: U, effort: 'max' }] } } },
    { effort_support: { [U]: ['xhigh'] } }, { effort_support: { [L]: ['low'] } },
    { optional_ling: { model: 'openrouter/billed' } },
    { classifier_chain: [{ kind: 'free_model', model: L, requires_public_preflight: false }] },
    JSON.parse('{"__proto__":{"enabled":true}}'),
    { grid: { coding: { 2: [JSON.parse('{"model":"openrouter/thinkingmachines/inkling-small:free","constructor":{}}')] } } },
  ])('c05 malformed settings are rejected, not partially activated: %j', free_mode => {
    expect(() => normaliseRouterGridConfig({ free_mode: { enabled: true, ...free_mode } })).toThrow();
  });
  it('c06 malformed override atomically disables Free and paid overrides, reporting only a reason', () => {
    const dir = mkdtempSync(join(tmpdir(), 'free-config-contract-')); // Evidence retained; no cleanup.
    const path = join(dir, 'router-grid.json');
    writeFileSync(path, JSON.stringify({ reserve_pct: 30, free_mode: { enabled: true, rpm_limit: -1, private_body: 'DO NOT REPORT' } }));
    const reasons: string[] = [];
    const c = loadRouterGridConfig(path, reason => reasons.push(reason));
    expect(c.reserve_pct).toBe(15);
    expect((c as any).free_mode.enabled).toBe(false);
    expect(reasons).toEqual(['invalid_router_free_config']);
  });
  it('c07 normalization is not verification; Ling requires flag and availability, privacy/verifier guards survive', async () => {
    const cfg = (await adapter()).adaptRouterFreeConfig(normaliseRouterGridConfig({ free_mode: { enabled: true } })).policy;
    const input = { config: cfg, classification: { tier: 2 as const, category: 'knowledge' as const, canQueue: false, containsPrivateData: false as const },
      privacyPreflight: false as const, realUser: true, hasImages: false, canVerify: true,
      availableVerifiedFreeModels: new Set<string>(), openCircuitModels: new Set<string>(), dailyRemaining: 50, dailyCount: 0, rpmCount: 0 };
    expect(selectFreeRoute(input)).toMatchObject({ kind: 'queue', reason: 'no_available_model' });
    expect(selectFreeRoute({ ...input, availableVerifiedFreeModels: new Set(['openrouter/billed', 'openrouter/unknown:free']) })).toMatchObject({ kind: 'queue' });
    const ling = (cfg.optionalLing as { model: string }).model;
    expect(selectFreeRoute({ ...input, availableVerifiedFreeModels: new Set([ling, I]) })).toMatchObject({ model: I });
    expect(selectFreeRoute({ ...input, config: { ...cfg, ling_verified_free: true }, availableVerifiedFreeModels: new Set([ling, I]) })).toMatchObject({ model: ling });
    expect(selectFreeRoute({ ...input, privacyPreflight: 'unknown' })).toMatchObject({ reason: 'privacy' });
    expect(selectFreeRoute({ ...input, canVerify: false })).toMatchObject({ reason: 'verification_unavailable' });
  });
  it('c08 policy defaults come from JSON; paid defaults remain unchanged', () => {
    const source = readFileSync(join(__dirname, 'router_free_policy.ts'), 'utf8');
    expect(source).toContain('defaults.free_mode');
    expect(source).not.toMatch(/openrouter\/|opencode\//);
    expect(normaliseRouterGridConfig({ reserve_pct: 20 }).routing).toEqual(defaultRouterGridConfig().routing);
    expect(defaultRouterGridConfig().openrouter_fallback).toEqual(defaults.openrouter_fallback);
  });
  it('c09 valid file overrides round-trip through the same settings loader without runtime activation', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'free-config-valid-'));
    const path = join(dir, 'router-grid.json');
    writeFileSync(path, JSON.stringify({ reserve_pct: 22, free_mode: { enabled: true, daily_reserve_pct: 0,
      paid_openrouter_budget_usd: 1.25, daily_reset_hour_utc: 23, daily_reset_minute_utc: 59 } }));
    const c = loadRouterGridConfig(path);
    expect(c.reserve_pct).toBe(22);
    expect(c.free_mode).toMatchObject({ enabled: true, paid_openrouter_budget_usd: 1.25 });
    expect((await adapter()).adaptRouterFreeConfig(c)).toMatchObject({ policy: { reserve_pct: 0 },
      state: { daily_reset_hour_utc: 23, daily_reset_minute_utc: 59 } });
    for (const file of ['router_grid_turn.ts', 'router_grid_classifier.ts', 'router_grid_select.ts']) {
      const source = readFileSync(join(__dirname, file), 'utf8');
      expect(source).not.toMatch(/adaptRouterFreeConfig|selectFreeRoute|RouterFreeStateStore/);
    }
  });
  it('c10 every positive count rejects zero, fractional, unsafe and nonfinite limits', () => {
    for (const key of ['rpm_limit', 'daily_request_limit', 'breaker_failures', 'failure_window_ms', 'breaker_open_ms',
      'retry_delay_ms', 'max_queue_entries', 'shadow_sampling_denominator', 'promotion_min_results']) {
      for (const limit of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
        expect(() => normaliseRouterGridConfig({ free_mode: { enabled: true, [key]: limit } })).toThrow();
    }
  });
  it('c11 guarded Ling cannot leak into coding/design/tier4 and conditional metadata cannot be stripped', async () => {
    const cfg = (await adapter()).adaptRouterFreeConfig(normaliseRouterGridConfig({ free_mode: { enabled: true, ling_verified_free: true } })).policy;
    const ling = (cfg.optionalLing as { model: string }).model;
    for (const [category, tier] of [['coding', 2], ['design', 2], ['knowledge', 4]] as const) {
      expect(selectFreeRoute({ config: cfg, classification: { category, tier, canQueue: false, containsPrivateData: false },
        privacyPreflight: false, realUser: true, hasImages: false, canVerify: true, availableVerifiedFreeModels: new Set([ling]),
        openCircuitModels: new Set(), dailyRemaining: 50, dailyCount: 0, rpmCount: 0 })).toMatchObject({ kind: 'queue' });
    }
    expect(() => normaliseRouterGridConfig({ free_mode: { grid: { knowledge: { 4: [{ model: F }] } } } })).toThrow();
    expect(() => normaliseRouterGridConfig({ free_mode: { grid: { coding: { 2: [{ model: P }] } } } })).toThrow();
    expect(() => normaliseRouterGridConfig({ free_mode: { grid: { coding: { 2: [{ model: ling }] } } } })).toThrow();
  });
});
