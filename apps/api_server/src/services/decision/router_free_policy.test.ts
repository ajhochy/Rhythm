import { beforeAll, describe, expect, it } from 'vitest';
import type { FreeCandidate, FreeModeConfig } from './router_free_policy';

// Missing implementation is an assertion failure, not a loader error, in Phase 0.
let policy: typeof import('./router_free_policy') | null = null;
beforeAll(async () => { policy = await import('./router_free_policy').catch(() => null); });
function grid(entries: readonly FreeCandidate[]): FreeModeConfig['grid'] {
  const tiers = { 1: entries, 2: entries, 3: entries, 4: entries };
  return { coding: tiers, knowledge: tiers, design: tiers };
}
const config = (): FreeModeConfig => ({
  enabled: true, skip_paid_openrouter: false, use_free_for_tier4: false,
  reserve_pct: 25, rpm_limit: 20, daily_request_limit: 50, ling_verified_free: false,
  grid: grid([{ model: 'free-a', effort: 'high' }, { model: 'free-b', effort: 'low' }]),
  optionalLing: { model: 'ling', effort: 'ling-effort' }, textOnly: ['free-a'],
  imageHelper: { model: 'helper', prompt: 'Describe inspected image', effort: 'helper-effort' },
  probation: ['probation'], forbiddenReal: ['stealth'], randomFallback: { model: 'random', effort: 'random-effort' },
});
const input = (overrides: Record<string, unknown> = {}) => ({
  config: config(), classification: { tier: 2, category: 'coding', canQueue: true, containsPrivateData: false },
  privacyPreflight: false, realUser: true, hasImages: false, canVerify: true,
  availableVerifiedFreeModels: new Set(['free-a', 'free-b', 'helper']), openCircuitModels: new Set<string>(),
  dailyRemaining: 50, dailyCount: 0, rpmCount: 0, ...overrides,
});
function select(overrides: Record<string, unknown> = {}) {
  expect(policy, 'pure policy module must exist').not.toBeNull();
  return policy!.selectFreeRoute(input(overrides) as Parameters<NonNullable<typeof policy>['selectFreeRoute']>[0]);
}
const exhausted = () => ['anthropic', 'anthropic', 'openai', 'openai'].map((provider, i) => ({ id: `account-${i}`, provider, exhausted: true, verified: true, fresh: true }));
function mode(overrides: Record<string, unknown> = {}) {
  expect(policy, 'pure policy module must exist').not.toBeNull();
  return policy!.determineFreeMode({ config: config(), accounts: exhausted(), paidOpenrouter: 'unavailable',
    wasActive: false, tier: 2, resetCrossed: false, ...overrides } as Parameters<NonNullable<typeof policy>['determineFreeMode']>[0]);
}

describe('Free Mode pure acceptance contract', () => {
  it('c22 stale verified exhaustion cannot authorize entry', () => {
    expect(mode({ accounts: exhausted().map(a => ({ ...a, fresh: false })) }).active).toBe(false);
  });
  it('c23 duplicates, missing identities and wrong provider counts cannot prove 2+2 exhaustion', () => {
    expect(mode({ accounts: exhausted().map(a => ({ ...a, id: 'duplicate' })) }).active).toBe(false);
    expect(mode({ accounts: exhausted().map(a => ({ ...a, provider: 'openai' })) }).active).toBe(false);
    expect(mode({ accounts: exhausted().map(a => ({ ...a, id: '' })) }).active).toBe(false);
  });
  it('c24 random duplicate in grid or Ling is considered only last and always degraded', () => {
    const cfg = { ...config(), grid: grid([{ model: 'random' }, { model: 'free-b' }, { model: 'random' }]) };
    expect(select({ config: cfg, availableVerifiedFreeModels: new Set(['random', 'free-b']) })).toMatchObject({ model: 'free-b', degraded: false });
    expect(select({ config: cfg, availableVerifiedFreeModels: new Set(['random']) })).toMatchObject({ model: 'random', degraded: true, effort: 'random-effort' });
    expect(select({ config: { ...cfg, optionalLing: 'random', ling_verified_free: true },
      classification: { tier: 2, category: 'knowledge', canQueue: true, containsPrivateData: false },
      availableVerifiedFreeModels: new Set(['random', 'free-b']) })).toMatchObject({ model: 'free-b', degraded: false });
    expect(select({ config: { ...cfg, optionalLing: 'random', ling_verified_free: false },
      availableVerifiedFreeModels: new Set(['random']) })).toMatchObject({ model: 'random', degraded: true, effort: 'random-effort' });
    const blocked = select({ config: cfg, availableVerifiedFreeModels: new Set(['random']), openCircuitModels: new Set(['random']) });
    expect(blocked.trace.filter(code => code === 'circuit_open')).toHaveLength(1);
  });
  it('c01 paid capacity prevents entry', () => expect(mode({ paidOpenrouter: 'available' }).active).toBe(false));
  it('c02 four proven exhaustions plus paid unavailable enters; skipPaid is explicit', () => {
    expect(mode().active).toBe(true);
    expect(mode({ config: { ...config(), skip_paid_openrouter: true }, paidOpenrouter: 'available' }).active).toBe(true);
  });
  it('c03 unknown quota or wrong account count cannot prove entry', () => {
    expect(mode({ accounts: [...exhausted().slice(0, 3), { exhausted: 'unknown', verified: true, fresh: true }] }).active).toBe(false);
    expect(mode({ accounts: exhausted().slice(0, 3) }).active).toBe(false);
  });
  it('c04 reset only requests refresh; recovery must be fresh and verified', () => {
    expect(mode({ wasActive: true, resetCrossed: true })).toMatchObject({ active: true, refreshRequired: true });
    for (const recovery of [{ exhausted: false, verified: true, fresh: false }, { exhausted: false, verified: false, fresh: true }])
      expect(mode({ wasActive: true, accounts: [recovery, ...exhausted().slice(1)] }).active).toBe(true);
    expect(mode({ wasActive: true, accounts: [{ exhausted: false, verified: true, fresh: true }, ...exhausted().slice(1)] }).active).toBe(false);
  });
  it('c05 default disabled and tier4 bypass requires explicit flag', () => {
    expect(mode({ config: { ...config(), enabled: undefined } }).active).toBe(false);
    expect(mode({ paidOpenrouter: 'available', accounts: [], tier: 4 }).active).toBe(false);
    expect(mode({ config: { ...config(), use_free_for_tier4: true }, paidOpenrouter: 'available', accounts: [], tier: 4 }).active).toBe(true);
  });
  it('c06 ordered T2 first; open circuit advances without changing effort', () => {
    expect(select()).toMatchObject({ kind: 'route', model: 'free-a', effort: 'high', degraded: false, helper: null, requiredCalls: 3 });
    expect(select({ openCircuitModels: new Set(['free-a']) })).toMatchObject({ kind: 'route', model: 'free-b', effort: 'low' });
  });
  it.each([true, 'unknown'])('c07 preflight %s holds before any free call', privacyPreflight => {
    expect(select({ privacyPreflight })).toMatchObject({ kind: 'queue', reason: 'privacy', paidRequired: true });
  });
  it.each([true, 'unknown'])('c08 classified privacy %s cannot waive preflight', containsPrivateData => {
    expect(select({ classification: { tier: 2, category: 'coding', canQueue: true, containsPrivateData } })).toMatchObject({ kind: 'queue', reason: 'privacy' });
  });
  it('c09 T1 queueable waits for paid; urgent T1 is degraded but verification mandatory', () => {
    const classification = { tier: 1, category: 'coding', canQueue: true, containsPrivateData: false };
    expect(select({ classification })).toMatchObject({ kind: 'queue', paidRequired: true });
    expect(select({ classification: { ...classification, canQueue: false } })).toMatchObject({ kind: 'route', degraded: true, requiredCalls: 3 });
    expect(select({ classification: { ...classification, canQueue: false }, canVerify: false })).toMatchObject({ kind: 'queue', reason: 'verification_unavailable' });
  });
  it('c10 screenshot descriptor reserves classifier/helper/answer/verifier', () => {
    expect(select({ hasImages: true })).toMatchObject({ kind: 'route', model: 'free-a', requiredCalls: 4,
      helper: { model: 'helper', prompt: 'Describe inspected image', effort: 'helper-effort' } });
  });
  it('c11 reserve boundary permits only T2; zero blocks all', () => {
    for (const tier of [1, 3, 4]) expect(select({ dailyRemaining: 12.5,
      classification: { tier, category: 'coding', canQueue: false, containsPrivateData: false } })).toMatchObject({ kind: 'queue', reason: 'daily_reserve' });
    expect(select({ dailyRemaining: 12.5 }).kind).toBe('route');
    expect(select({ dailyRemaining: 0 })).toMatchObject({ kind: 'queue', reason: 'daily_budget' });
  });
  it('c12 Ling is opt-in verified knowledge1..3 only', () => {
    const availableVerifiedFreeModels = new Set(['free-a', 'ling']);
    const classification = { tier: 2, category: 'knowledge', canQueue: false, containsPrivateData: false };
    expect(select({ classification, availableVerifiedFreeModels })).toMatchObject({ model: 'free-a' });
    expect(select({ config: { ...config(), ling_verified_free: true }, classification, availableVerifiedFreeModels })).toMatchObject({ model: 'ling', effort: 'ling-effort' });
    expect(select({ config: { ...config(), ling_verified_free: true }, availableVerifiedFreeModels })).toMatchObject({ model: 'free-a' });
    expect(select({ config: { ...config(), ling_verified_free: true }, classification })).toMatchObject({ model: 'free-a' });
  });
  it('c13 forbidden/probation override every list; unavailable random queues', () => {
    const blocked = config();
    blocked.grid = grid([{ model: 'stealth', effort: 'x' }, { model: 'probation', effort: 'y' }]);
    expect(select({ config: blocked, availableVerifiedFreeModels: new Set(['stealth', 'probation']) })).toMatchObject({ kind: 'queue', reason: 'no_available_model' });
    expect(select({ config: blocked, availableVerifiedFreeModels: new Set(['random']) })).toMatchObject({ kind: 'route', model: 'random', degraded: true });
    expect(select({ config: { ...blocked, randomFallback: { model: 'stealth', effort: 'x' } }, availableVerifiedFreeModels: new Set(['stealth']) }).kind).toBe('queue');
  });
  it('c14 no verifier blocks every free tier and fallback', () => {
    for (const tier of [1, 2, 3, 4]) expect(select({ canVerify: false,
      classification: { tier, category: 'coding', canQueue: false, containsPrivateData: false } })).toMatchObject({ kind: 'queue', reason: 'verification_unavailable' });
  });
  it('c15 helper unavailable/broken/probation cannot start; budgets include all calls', () => {
    for (const overrides of [{ availableVerifiedFreeModels: new Set(['free-a']) }, { openCircuitModels: new Set(['helper']) },
      { config: { ...config(), probation: ['helper'] } }])
      expect(select({ hasImages: true, ...overrides, availableVerifiedFreeModels: overrides.availableVerifiedFreeModels ?? new Set(['free-a', 'helper']) }).kind).toBe('queue');
    expect(select({ hasImages: true, dailyRemaining: 3, availableVerifiedFreeModels: new Set(['free-a', 'helper']) })).toMatchObject({ kind: 'queue', reason: 'daily_budget' });
    expect(select({ hasImages: true, dailyCount: 47, availableVerifiedFreeModels: new Set(['free-a', 'helper']) }).kind).toBe('queue');
    expect(select({ hasImages: true, rpmCount: 17, availableVerifiedFreeModels: new Set(['free-a', 'helper']) })).toMatchObject({ kind: 'queue', reason: 'rpm_budget' });
    expect(select({ hasImages: true, dailyRemaining: 4, rpmCount: 16, availableVerifiedFreeModels: new Set(['free-a', 'helper']) }).kind).toBe('route');
  });
  it('c16 queue priority T1 then oldest without reclassification, mutation or prompt retention', () => {
    expect(policy).not.toBeNull();
    const queue = [{ taskId: 'old', reference: 'ref-old', enqueuedAt: 1, classification: { tier: 2, category: 'coding', canQueue: true, containsPrivateData: false }, prompt: 'DO NOT RETAIN' },
      { taskId: 'new', reference: 'ref-new', enqueuedAt: 3, classification: { tier: 1, category: 'design', canQueue: true, containsPrivateData: false } },
      { taskId: 'older-t1', reference: 'ref-t1', enqueuedAt: 2, classification: { tier: 1, category: 'knowledge', canQueue: true, containsPrivateData: false } }];
    const sorted = policy!.sortFreeQueue(queue as Parameters<NonNullable<typeof policy>['sortFreeQueue']>[0]);
    expect(sorted.map(x => x.taskId)).toEqual(['older-t1', 'new', 'old']);
    expect(sorted[0].classification).toEqual(queue[2].classification);
    expect(queue.map(x => x.taskId)).toEqual(['old', 'new', 'older-t1']);
    expect(JSON.stringify(sorted)).not.toContain('DO NOT RETAIN');
    expect(Object.keys(sorted[0]).sort()).toEqual(['classification', 'enqueuedAt', 'reference', 'taskId']);
  });
  it('c17 trace and queue are body-free even when extra input fields exist', () => {
    const marker = 'PRIVATE TASK BODY';
    const result = select({ prompt: marker, classification: { ...input().classification, prompt: marker },
      privacyPreflight: true });
    expect(JSON.stringify(result)).not.toContain(marker);
    expect(result.trace).toEqual(['privacy']);
    expect(Object.keys(result).sort()).toEqual(['kind', 'paidRequired', 'reason', 'trace']);
    const route = select({ prompt: marker, classification: { ...input().classification, prompt: marker }, hasImages: true });
    expect(JSON.stringify(route.trace)).not.toContain(marker);
    expect(JSON.stringify(route.trace)).not.toContain(config().imageHelper.prompt);
  });
  it('c18 paid recovery also needs fresh verification; unknown paid capacity is not exhaustion', () => {
    expect(mode({ paidOpenrouter: 'unknown' }).active).toBe(false);
    expect(mode({ wasActive: true, paidOpenrouter: 'available' }).active).toBe(true);
    expect(mode({ wasActive: true, paidRecovery: { available: true, verified: true, fresh: false } }).active).toBe(true);
    expect(mode({ wasActive: true, paidRecovery: { available: true, verified: true, fresh: true } }).active).toBe(false);
  });
  it('c19 configured thresholds and numeric defaults drive admission, never model constants', () => {
    expect(policy!.FREE_MODE_DEFAULTS).toEqual({ enabled: false, skip_paid_openrouter: false, use_free_for_tier4: false,
      reserve_pct: 25, rpm_limit: 20, daily_request_limit: 50, ling_verified_free: false });
    expect(select({ config: { ...config(), reserve_pct: 50 }, dailyRemaining: 25,
      classification: { tier: 3, category: 'coding', canQueue: false, containsPrivateData: false } })).toMatchObject({ reason: 'daily_reserve' });
    expect(select({ config: { ...config(), daily_request_limit: 10 }, dailyCount: 8 })).toMatchObject({ reason: 'daily_budget' });
    expect(select({ config: { ...config(), rpm_limit: 2 } })).toMatchObject({ reason: 'rpm_budget' });
  });
  it('c20 random remains privacy/verifier gated; forbidden helper cannot receive real images', () => {
    const availableVerifiedFreeModels = new Set(['random']);
    expect(select({ availableVerifiedFreeModels, privacyPreflight: 'unknown' })).toMatchObject({ reason: 'privacy' });
    expect(select({ availableVerifiedFreeModels, canVerify: false })).toMatchObject({ reason: 'verification_unavailable' });
    expect(select({ hasImages: true, config: { ...config(), forbiddenReal: ['helper'] },
      availableVerifiedFreeModels: new Set(['free-a', 'helper']) })).toMatchObject({ kind: 'queue' });
  });
  it('c21 invalid budgets fail closed, selection preserves input sets/config', () => {
    for (const dailyRemaining of [NaN, Infinity]) expect(select({ dailyRemaining })).toMatchObject({ reason: 'invalid_budget' });
    const supplied = input();
    const before = JSON.stringify(supplied.config);
    select(supplied);
    expect(JSON.stringify(supplied.config)).toBe(before);
    expect([...supplied.availableVerifiedFreeModels]).toEqual(['free-a', 'free-b', 'helper']);
  });
});
