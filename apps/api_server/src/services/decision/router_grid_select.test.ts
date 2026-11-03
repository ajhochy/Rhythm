import { describe, expect, it } from 'vitest';
// RED used caught dynamic imports; maintained tests use compiler-checked imports, no SUT mocks.
import * as selector from './router_grid_select';
import * as configModule from './router_grid_config';
import * as classifier from './router_grid_classifier';
import * as clientModule from './openai_decisions_client';
const now = Date.parse('2026-10-08T12:00:00Z');
const accounts = () => [
  { id: 'a1', provider: 'anthropic', quotaRemainingPct: 60, resetsAt: now + 2000, exhaustedUntil: null },
  { id: 'a2', provider: 'anthropic', quotaRemainingPct: 80, resetsAt: now + 1000, exhaustedUntil: null },
  { id: 'o1', provider: 'openai', quotaRemainingPct: 60, resetsAt: now + 2000, exhaustedUntil: null },
  { id: 'o2', provider: 'openai', quotaRemainingPct: 80, resetsAt: now + 1000, exhaustedUntil: null },
];
function run(tier = 4, category = 'coding', changes: Record<string, unknown> = {}) {
  expect(selector, 'grid selector export must exist').not.toBeNull();
  const config = configModule!.defaultRouterGridConfig();
  return selector!.selectRoute({ config, classification: { tier, category, canQueue: false, securitySensitive: false, estInputTokens: 10 },
    accounts: accounts(), availableModels: new Set(Object.keys(config.models)), openrouterUsable: true, now, weekdayPeak: false, ...changes } as Parameters<NonNullable<typeof selector>['selectRoute']>[0]);
}
const exhausted = () => accounts().map(a => ({ ...a, exhaustedUntil: now + 10000 }));
describe('grid spec — exact routes catch wrong order, reserve, rules and fallback', () => {
  it('AT1: tier 4 extraction, healthy -> Haiku low, most Anthropic quota', () => expect(run()).toMatchObject({ kind: 'route', model: 'anthropic/claude-haiku-5-5', effort: 'low', accountId: 'a2', degraded: false, tierUsed: 4 }));
  it('AT2: Anthropic exhausted -> Luna max, most OpenAI quota', () => expect(run(4, 'coding', { accounts: accounts().map(a => ({ ...a, exhaustedUntil: a.provider === 'anthropic' ? now + 1 : null })) })).toMatchObject({ model: 'openai/gpt-6-luna', effort: 'max', accountId: 'o2' }));
  it('AT3: OpenAI 10/12% reserve -> Sonnet high', () => expect(run(2, 'coding', { accounts: accounts().map(a => ({ ...a, quotaRemainingPct: a.provider === 'openai' ? (a.id === 'o1' ? 10 : 12) : 80 })) })).toMatchObject({ model: 'anthropic/claude-sonnet-5-5', effort: 'high' }));
  it('AT4: tier 1 exempts Anthropic 10/12% -> Sonnet xhigh 12%', () => expect(run(1, 'coding', { accounts: accounts().map(a => ({ ...a, quotaRemainingPct: a.id === 'a1' ? 10 : 12 })) })).toMatchObject({ model: 'anthropic/claude-sonnet-5-5', effort: 'xhigh', accountId: 'a2' }));
  it('AT5: tier 3 400K skips both, steps up, skips Sol -> Sonnet high', () => {
    const r = run(3, 'coding', { classification: { tier: 3, category: 'coding', canQueue: false, securitySensitive: false, estInputTokens: 400000 } });
    expect(r).toMatchObject({ model: 'anthropic/claude-sonnet-5-5', effort: 'high', tierUsed: 2 });
    expect(r.trace.filter(t => t.action === 'skip_rule').map(t => t.model)).toEqual(['anthropic/claude-haiku-5-5', 'openai/gpt-6-sol', 'openai/gpt-6.1-sol']);
  });
  it('AT6: tier 1 knowledge exhausted, can_queue -> MiMo degraded, trace records queue', () => {
    const r = run(1, 'knowledge', { accounts: exhausted(), classification: { tier: 1, category: 'knowledge', canQueue: true, securitySensitive: false, estInputTokens: 10 } });
    expect(r).toMatchObject({ kind: 'route', model: 'openrouter/xiaomi/mimo-v2.6-pro', degraded: true, accountId: null });
    expect(r.trace).toContainEqual(expect.objectContaining({ action: 'fallback', canQueue: true }));
  });
  it('AT7: tier 1 knowledge cannot queue -> MiMo degraded', () => expect(run(1, 'knowledge', { accounts: exhausted() })).toMatchObject({ model: 'openrouter/xiaomi/mimo-v2.6-pro', degraded: true }));
  it('AT8: tier 1 design exhausted -> Kimi K3', () => expect(run(1, 'design', { accounts: exhausted() })).toMatchObject({ model: 'openrouter/moonshotai/kimi-k3', provider: 'openrouter', degraded: false }));
  it('AT9: tier 2 security skips Sonnet -> GPT-6.1 Sol max', () => expect(run(2, 'coding', { classification: { tier: 2, category: 'coding', canQueue: false, securitySensitive: true, estInputTokens: 10 } })).toMatchObject({ model: 'openai/gpt-6.1-sol', effort: 'max' }));
  it('AT10: exhausted OpenAI accounts do not supply classifier auth; API failure -> rules default', async () => {
    expect(classifier).not.toBeNull();
    expect(exhausted().filter(a => a.provider === 'openai').every(a => a.exhaustedUntil! > now)).toBe(true);
    const client = new clientModule.OpenAIDecisionsClient({ baseUrl: 'http://127.0.0.1:1', model: 'gpt-6-luna', apiKey: 'synthetic', consent: true, fetchImpl: async () => new Response('', { status: 429 }) });
    expect(await classifier!.classifyRouterGrid('edit code', configModule!.defaultRouterGridConfig(), client)).toMatchObject({ tier: 2, category: 'coding', source: 'rules', reason: 'http_429' });
  });
  it('AT11: tied quota picks earliest reset', () => expect(run(4, 'coding', { accounts: accounts().map(a => ({ ...a, quotaRemainingPct: 80 })) })).toMatchObject({ accountId: 'a2' }));
  it('zero-c4: unknown usage wins over exhausted zero, even at tier 1', () => {
    const a = accounts().filter(a => a.provider === 'anthropic').map(a => ({ ...a, quotaRemainingPct: a.id === 'a1' ? null : 0 }));
    expect(run(1, 'coding', { accounts: a })).toMatchObject({ accountId: 'a1' });
    expect(run(4, 'coding', { accounts: a })).toMatchObject({ accountId: 'a1' });
  });
  it.each([0, -1])('zero-c1: tier 1 rejects sole known %s without a cooldown', quotaRemainingPct => {
    const a: selector.GridAccount = { id: 'spent', provider: 'anthropic', quotaRemainingPct, resetsAt: null, exhaustedUntil: null };
    const trace: selector.GridTrace[] = [];
    expect(selector.pickGridAccount('anthropic', 1, [a], 15, now, trace)).toBeNull();
    expect(trace).toEqual([{ action: 'skip_account', tier: 1, accountId: 'spent', reason: 'exhausted' }]);
    expect(a.exhaustedUntil).toBeNull();
    expect(a.quotaRemainingPct).toBe(quotaRemainingPct);
  });
  it('zero-c2: tier 1 all known zero cannot route closed accounts; falls back only when usable', () => {
    const a = accounts().map(a => ({ ...a, quotaRemainingPct: 0 }));
    expect(run(1, 'coding', { accounts: a, openrouterUsable: false })).toMatchObject({ kind: 'none', reason: 'no_usable_route' });
    expect(run(1, 'coding', { accounts: a })).toMatchObject({ kind: 'route', provider: 'openrouter', accountId: null });
  });
  it.each([2, 3, 4] as const)('zero-c5: tier %s skips known zero as exhausted, not reserve', tier => {
    const trace: selector.GridTrace[] = [];
    expect(selector.pickGridAccount('openai', tier, [{ id: 'spent', provider: 'openai', quotaRemainingPct: 0, resetsAt: null, exhaustedUntil: null }], 15, now, trace)).toBeNull();
    expect(trace).toEqual([{ action: 'skip_account', tier, accountId: 'spent', reason: 'exhausted' }]);
  });
  it('zero-c6: tier 1 positive 0.1 remains eligible and outranks unknown', () => {
    const a: selector.GridAccount[] = [
      { id: 'unknown', provider: 'anthropic', quotaRemainingPct: null, resetsAt: now, exhaustedUntil: null },
      { id: 'positive', provider: 'anthropic', quotaRemainingPct: 0.1, resetsAt: null, exhaustedUntil: null },
    ];
    expect(selector.pickGridAccount('anthropic', 1, a, 15, now)?.id).toBe('positive');
  });
  it('zero-c7: positive quota and unknown quota still obey per-account cooldown', () => {
    const a: selector.GridAccount[] = [
      { id: 'cooling', provider: 'anthropic', quotaRemainingPct: 12, resetsAt: null, exhaustedUntil: now + 1 },
      { id: 'unknown', provider: 'anthropic', quotaRemainingPct: null, resetsAt: null, exhaustedUntil: now + 1 },
      { id: 'ready', provider: 'anthropic', quotaRemainingPct: 0.1, resetsAt: null, exhaustedUntil: now },
    ];
    expect(selector.pickGridAccount('anthropic', 1, a, 15, now)?.id).toBe('ready');
  });
  it('unavailable models are rule skips and step up normally with reserve exemption', () => expect(run(4, 'coding', { availableModels: new Set(['anthropic/claude-sonnet-5-5']), accounts: accounts().map(a => ({ ...a, quotaRemainingPct: 15 })) })).toMatchObject({ model: 'anthropic/claude-sonnet-5-5', tierUsed: 1, effort: 'xhigh' }));
  it('OpenRouter unusable or unavailable -> none', () => {
    expect(run(4, 'coding', { accounts: exhausted(), openrouterUsable: false })).toMatchObject({ kind: 'none' });
    expect(run(4, 'coding', { accounts: exhausted(), availableModels: new Set() })).toMatchObject({ kind: 'none' });
  });
  it('DeepSeek weekday peak moves last, off-peak stays first', () => {
    expect(run(4, 'coding', { accounts: exhausted(), weekdayPeak: true })).toMatchObject({ model: 'openrouter/xiaomi/mimo-v2.6-flash' });
    expect(run(4, 'coding', { accounts: exhausted(), weekdayPeak: false })).toMatchObject({ model: 'openrouter/deepseek/deepseek-v4.1-flash' });
  });
  it('recursive rule step-up stops at tier 1, fallback uses ORIGINAL tier, body-free trace', () => {
    const r = run(4, 'coding', { availableModels: new Set(['openrouter/xiaomi/mimo-v2.6-flash']), classification: { tier: 4, category: 'coding', canQueue: true, securitySensitive: true, estInputTokens: 400000, prompt: 'PRIVATE PROMPT' } });
    expect(r).toMatchObject({ model: 'openrouter/xiaomi/mimo-v2.6-flash', tierUsed: 4, degraded: false });
    expect(r.trace.filter(t => t.action === 'step_up').map(t => t.tier)).toEqual([3, 2, 1]);
    expect(JSON.stringify(r)).not.toContain('PRIVATE PROMPT');
  });
  it('reserve is strictly >15 and expiration at now is usable', () => expect(run(4, 'coding', { accounts: accounts().map(a => ({ ...a, quotaRemainingPct: a.provider === 'anthropic' ? 15 : 16, exhaustedUntil: now })) })).toMatchObject({ model: 'openai/gpt-6-luna' }));
  it('security skip is observable even when Anthropic is first; inputs stay immutable', () => {
    const config = configModule.defaultRouterGridConfig();
    config.routing.coding[2].reverse();
    const before = JSON.stringify(config);
    const r = run(2, 'coding', { config, classification: { tier: 2, category: 'coding', canQueue: false, securitySensitive: true, estInputTokens: 10 } });
    expect(r).toMatchObject({ model: 'openai/gpt-6.1-sol' });
    expect(r.trace[0]).toEqual({ action: 'skip_rule', tier: 2, model: 'anthropic/claude-sonnet-5-5', reason: 'security_sensitive' });
    expect(JSON.stringify(config)).toBe(before);
  });
  it('one rule skip plus one account failure still steps up with normal account checks', () => {
    const config = configModule.defaultRouterGridConfig();
    const availableModels = new Set(Object.keys(config.models)); availableModels.delete('anthropic/claude-haiku-5-5');
    const r = run(4, 'coding', { config, availableModels, accounts: accounts().map(a => ({ ...a, exhaustedUntil: a.provider === 'openai' ? now + 1 : null })) });
    expect(r).toMatchObject({ model: 'anthropic/claude-sonnet-5-5', tierUsed: 2 });
    expect(r.trace.filter(t => t.action === 'step_up').map(t => t.tier)).toEqual([3, 2]);
  });
  it('surcharge conditions are strict greater-than at Haiku and OpenAI thresholds', () => {
    expect(run(4, 'coding', { classification: { tier: 4, category: 'coding', canQueue: false, securitySensitive: false, estInputTokens: 100000 } })).toMatchObject({ model: 'anthropic/claude-haiku-5-5' });
    expect(run(4, 'coding', { classification: { tier: 4, category: 'coding', canQueue: false, securitySensitive: false, estInputTokens: 272000 } })).toMatchObject({ model: 'openai/gpt-6-luna' });
  });
});
