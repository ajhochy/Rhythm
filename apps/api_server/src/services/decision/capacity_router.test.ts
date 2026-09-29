import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';

const getUsageBudget = vi.fn();
vi.mock('../usage_budget_service', () => ({ getUsageBudget: (...a: unknown[]) => getUsageBudget(...a) }));

import { runMigrations } from '../../database/migrations';
import { setDb } from '../../database/db';
import { classifyRouteTier } from '../agent_model_resolver';
import type { UsageBudgetProvider, UsageBudgetSnapshot } from '../usage_budget_service';
import { listDecisions } from './decision_log';
import {
  accountHeadroom,
  applyCapacityRouting,
  autoPickAccountId,
  chooseCapacityRoute,
  clearAutoAccountSessionsForTests,
  isAutoAccountSession,
  markAutoAccountSession,
  pickAccount,
  resetCapacityRefreshForTests,
} from './capacity_router';

const ENV = [
  'AGENT_DECISION_CAPACITY_ROUTING', 'AGENT_DECISION_CAPACITY_LOW_FRACTION',
  'AGENT_DECISION_CAPACITY_CROSS_AGENT',
];
let saved: Record<string, string | undefined>;
let db: Database.Database;
let prev: Database.Database | null;

type Entry = Partial<UsageBudgetProvider> & { provider: UsageBudgetProvider['provider'] };
const fractions = (...f: Array<number | null>) =>
  f.map((remainingFraction, i) => ({ label: `w${i}`, remainingFraction, resetAt: null }));
const entry = (e: Entry, ...f: Array<number | null>): UsageBudgetProvider => ({
  label: e.provider,
  kind: 'window',
  items: fractions(...f),
  ...e,
});
const snap = (...providers: UsageBudgetProvider[]): UsageBudgetSnapshot => ({
  providers,
  fetchedAt: '2026-09-29T00:00:00Z',
});

const OPUS = { providerID: 'anthropic', modelID: 'claude-opus-4-7' };
const SONNET = { providerID: 'anthropic', modelID: 'claude-sonnet-4-6' };
const HAIKU = { providerID: 'anthropic', modelID: 'claude-haiku-4-5' };
const OR_SONNET = { providerID: 'openrouter', modelID: 'anthropic/claude-sonnet-4.6' };

beforeEach(() => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  db = new Database(':memory:');
  runMigrations(db);
  prev = setDb(db);
  getUsageBudget.mockReset();
  clearAutoAccountSessionsForTests();
  resetCapacityRefreshForTests();
});
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  setDb(prev);
  db.close();
});

describe('accountHeadroom / pickAccount', () => {
  it('takes the min across windows', () => {
    const h = accountHeadroom(snap(entry({ provider: 'anthropic', accountId: 'a' }, 0.8, 0.3)));
    expect(h[0].headroom).toBe(0.3);
  });

  it('excludes unavailable, ignores null items, null when none known', () => {
    const h = accountHeadroom(
      snap(
        entry({ provider: 'anthropic', accountId: 'a', kind: 'unavailable' }, 0.9),
        entry({ provider: 'anthropic', accountId: 'b' }, null, 0.5),
        entry({ provider: 'anthropic', accountId: 'c' }, null),
      ),
    );
    expect(h.map((x) => [x.accountId, x.headroom])).toEqual([['b', 0.5], ['c', null]]);
  });

  it('picks the max-headroom account among two', () => {
    const s = snap(
      entry({ provider: 'anthropic', accountId: 'a', isDefault: true }, 0.4, 0.9),
      entry({ provider: 'anthropic', accountId: 'b' }, 0.6, 0.7),
    );
    expect(pickAccount('anthropic', s)).toBe('b');
  });

  it('uses the min of 5h/7d, not the best window', () => {
    const s = snap(
      entry({ provider: 'anthropic', accountId: 'a' }, 0.95, 0.1),
      entry({ provider: 'anthropic', accountId: 'b' }, 0.5, 0.45),
    );
    expect(pickAccount('anthropic', s)).toBe('b');
  });

  it('never picks an unavailable account', () => {
    const s = snap(
      entry({ provider: 'anthropic', accountId: 'a', kind: 'unavailable' }, 0.99),
      entry({ provider: 'anthropic', accountId: 'b' }, 0.2),
    );
    expect(pickAccount('anthropic', s)).toBe('b');
  });

  it('ranks unknown below a known non-low account but above a low one', () => {
    const unknown = entry({ provider: 'anthropic', accountId: 'u' }, null);
    expect(
      pickAccount('anthropic', snap(unknown, entry({ provider: 'anthropic', accountId: 'k' }, 0.5))),
    ).toBe('k');
    expect(
      pickAccount('anthropic', snap(entry({ provider: 'anthropic', accountId: 'l' }, 0.05), unknown)),
    ).toBe('u');
  });

  it('breaks ties by default then stable order', () => {
    const s = snap(
      entry({ provider: 'anthropic', accountId: 'a' }, 0.5),
      entry({ provider: 'anthropic', accountId: 'b', isDefault: true }, 0.5),
      entry({ provider: 'anthropic', accountId: 'c' }, 0.5),
    );
    expect(pickAccount('anthropic', s)).toBe('b');
    expect(
      pickAccount(
        'anthropic',
        snap(entry({ provider: 'anthropic', accountId: 'a' }, 0.5), entry({ provider: 'anthropic', accountId: 'c' }, 0.5)),
      ),
    ).toBe('a');
  });

  it('returns null with no entries for the provider', () => {
    expect(pickAccount('openai', snap(entry({ provider: 'anthropic', accountId: 'a' }, 0.5)))).toBeNull();
  });
});

describe('classifyRouteTier equivalence', () => {
  it('maps sol frontier, terra standard, luna cheap', () => {
    expect(classifyRouteTier({ providerID: 'openai', modelID: 'gpt-5.6-sol' })).toBe('frontier');
    expect(classifyRouteTier({ providerID: 'openai', modelID: 'gpt-5.6-terra' })).toBe('standard');
    expect(classifyRouteTier({ providerID: 'openai', modelID: 'gpt-5.6-luna' })).toBe('cheap');
  });
});

describe('chooseCapacityRoute', () => {
  // Providers that report usage; github-copilot has no usage data (unknown headroom).
  const base = { agentId: 'claude-code', authedProviders: ['anthropic', 'openrouter'] };

  it('keeps the base route on the best account when it has capacity', () => {
    const r = chooseCapacityRoute({
      ...base,
      requiredTier: 'frontier',
      baseRoute: OPUS,
      snapshot: snap(
        entry({ provider: 'anthropic', accountId: 'a' }, 0.3),
        entry({ provider: 'anthropic', accountId: 'b' }, 0.8),
      ),
    });
    expect(r).toMatchObject({ route: OPUS, accountId: 'b', allLow: false });
  });

  it('does not treat unknown headroom (or no data) as low', () => {
    const unknown = chooseCapacityRoute({
      ...base,
      requiredTier: 'frontier',
      baseRoute: OPUS,
      snapshot: snap(entry({ provider: 'anthropic', accountId: 'a' }, null)),
    });
    expect(unknown.route).toEqual(OPUS);
    const none = chooseCapacityRoute({ ...base, requiredTier: 'frontier', baseRoute: OPUS, snapshot: snap() });
    expect(none).toMatchObject({ route: OPUS, accountId: null, allLow: false });
  });

  it('switches to another provider at the same tier when the base provider is low', () => {
    const r = chooseCapacityRoute({
      ...base,
      requiredTier: 'frontier',
      baseRoute: OPUS,
      snapshot: snap(
        entry({ provider: 'anthropic', accountId: 'a' }, 0.05),
        entry({ provider: 'openrouter' }, 0.7),
      ),
    });
    expect(r.route.providerID).toBe('openrouter');
    expect(r.route.modelID).toContain('opus');
    expect(r.allLow).toBe(false);
  });

  it('honours authedProviders when switching', () => {
    const r = chooseCapacityRoute({
      ...base,
      requiredTier: 'frontier',
      baseRoute: OPUS,
      authedProviders: ['anthropic'],
      snapshot: snap(
        entry({ provider: 'anthropic', accountId: 'a' }, 0.05),
        entry({ provider: 'openrouter' }, 0.7),
      ),
    });
    expect(r.allLow).toBe(true);
    expect(r.route.providerID).toBe('anthropic');
  });

  it('base low, cheap job -> switches to the keyless local model (never low) when authed', () => {
    const r = chooseCapacityRoute({
      agentId: 'opencode',
      requiredTier: 'cheap',
      baseRoute: { providerID: 'openrouter', modelID: 'anthropic/claude-haiku-4.5' },
      authedProviders: ['openrouter', 'ollama'],
      snapshot: snap(entry({ provider: 'openrouter' }, 0.05)),
    });
    expect(r).toMatchObject({ allLow: false, accountId: null });
    expect(r.route.providerID).toBe('ollama');
  });

  it('all low, cheap job -> cheapest tier, never above needed', () => {
    const r = chooseCapacityRoute({
      ...base,
      requiredTier: 'cheap',
      baseRoute: SONNET,
      snapshot: snap(
        entry({ provider: 'anthropic', accountId: 'a' }, 0.1),
        entry({ provider: 'openrouter' }, 0.08),
      ),
    });
    expect(r.allLow).toBe(true);
    expect(classifyRouteTier(r.route)).toBe('cheap');
    expect(r.route).toEqual(HAIKU);
    expect(r.accountId).toBe('a');
  });

  it('all low, frontier job -> a frontier-capable route, never cheaper', () => {
    const r = chooseCapacityRoute({
      ...base,
      requiredTier: 'frontier',
      baseRoute: OPUS,
      snapshot: snap(
        entry({ provider: 'anthropic', accountId: 'a' }, 0.1),
        entry({ provider: 'openrouter' }, 0.12),
      ),
    });
    expect(r.allLow).toBe(true);
    expect(classifyRouteTier(r.route)).toBe('frontier');
    // Same tier is equivalent: most headroom wins.
    expect(r.route.providerID).toBe('openrouter');
  });

  it('all low, standard job: 9.9% sonnet beats 6.5% equivalent on another account', () => {
    const snapshot = snap(
      entry({ provider: 'anthropic', accountId: 'claude-a' }, 0.099),
      entry({ provider: 'openrouter' }, 0.065),
    );
    for (const baseRoute of [SONNET, OR_SONNET]) {
      const r = chooseCapacityRoute({ ...base, requiredTier: 'standard', baseRoute, snapshot });
      expect(r).toMatchObject({ route: SONNET, accountId: 'claude-a', allLow: true });
    }
  });

  it('all low: picks the best account within the chosen provider', () => {
    const r = chooseCapacityRoute({
      ...base,
      requiredTier: 'standard',
      baseRoute: SONNET,
      snapshot: snap(
        entry({ provider: 'anthropic', accountId: 'a' }, 0.05),
        entry({ provider: 'anthropic', accountId: 'b' }, 0.11),
        entry({ provider: 'openrouter' }, 0.02),
      ),
    });
    expect(r).toMatchObject({ route: SONNET, accountId: 'b', allLow: true });
  });
});

describe('unknown headroom ordering', () => {
  const noAuthFilter = { agentId: 'claude-code' };

  it('rule 2: a known non-low provider beats an unknown one (copilot has no usage data)', () => {
    const r = chooseCapacityRoute({
      ...noAuthFilter,
      requiredTier: 'standard',
      baseRoute: SONNET,
      snapshot: snap(
        entry({ provider: 'anthropic', accountId: 'a' }, 0.05),
        entry({ provider: 'openrouter' }, 0.4),
      ),
    });
    expect(r.route.providerID).toBe('openrouter');
    expect(r.allLow).toBe(false);
  });

  it('rule 2: unknown wins only when no known non-low candidate exists', () => {
    const r = chooseCapacityRoute({
      ...noAuthFilter,
      requiredTier: 'standard',
      baseRoute: SONNET,
      snapshot: snap(
        entry({ provider: 'anthropic', accountId: 'a' }, 0.05),
        entry({ provider: 'openrouter' }, 0.02),
      ),
    });
    expect(r.route.providerID).toBe('github-copilot');
    expect(r.accountId).toBeNull();
    expect(r.allLow).toBe(false);
  });

  it('rule 3: unknown at the required tier beats a known-low one', () => {
    // Base is not in the fallback table, so only the base and unknown-data
    // candidates compete; base (known low) must lose to the unknown copilot route.
    const r = chooseCapacityRoute({
      agentId: 'claude-code',
      requiredTier: 'cheap',
      baseRoute: HAIKU,
      authedProviders: ['anthropic', 'github-copilot'],
      snapshot: snap(entry({ provider: 'anthropic', accountId: 'a' }, 0.05)),
    });
    expect(r.route.providerID).toBe('github-copilot');
    expect(classifyRouteTier(r.route)).toBe('cheap');
  });
});

describe('applyCapacityRouting', () => {
  const lowAnthropic = snap(
    entry({ provider: 'anthropic', accountId: 'a' }, 0.05),
    entry({ provider: 'openrouter' }, 0.7),
  );
  const input = {
    agentId: 'claude-code',
    baseRoute: OPUS,
    requiredTier: 'frontier' as const,
    requestedSource: 'agent_default',
    authedProviders: ['anthropic', 'openrouter'],
  };

  it('off returns null without reading the snapshot', async () => {
    expect(await applyCapacityRouting(input)).toBeNull();
    expect(await autoPickAccountId('anthropic')).toBeNull();
    expect(getUsageBudget).not.toHaveBeenCalled();
  });

  it('reads only the cache and returns null when it is empty', async () => {
    process.env.AGENT_DECISION_CAPACITY_ROUTING = 'on';
    getUsageBudget.mockResolvedValue(snap());
    expect(await applyCapacityRouting(input)).toBeNull();
    expect(getUsageBudget).toHaveBeenCalledWith({ cachedOnly: true });
  });

  it('on reroutes and logs', async () => {
    process.env.AGENT_DECISION_CAPACITY_ROUTING = 'on';
    getUsageBudget.mockResolvedValue(lowAnthropic);
    const d = await applyCapacityRouting({ ...input, sessionId: 's1', currentAccountId: 'a' });
    expect(d?.routeChanged).toBe(true);
    expect(d?.route.providerID).toBe('openrouter');
    const rows = listDecisions({ feature: 'capacity_routing' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ applied: true, mode: 'on', baseline: 'anthropic/claude-opus-4-7@a' });
    expect(rows[0].chosen).toMatch(/^openrouter\/.+@default$/);
    expect(rows[0].detail).toMatchObject({ allLow: false, requiredTier: 'frontier' });
  });

  it('shadow logs but returns null', async () => {
    process.env.AGENT_DECISION_CAPACITY_ROUTING = 'shadow';
    getUsageBudget.mockResolvedValue(lowAnthropic);
    expect(await applyCapacityRouting(input)).toBeNull();
    const rows = listDecisions({ feature: 'capacity_routing' });
    expect(rows).toHaveLength(1);
    expect(rows[0].applied).toBe(false);
  });

  it('pinned sources keep their model but get the best account', async () => {
    process.env.AGENT_DECISION_CAPACITY_ROUTING = 'on';
    getUsageBudget.mockResolvedValue(
      snap(
        entry({ provider: 'anthropic', accountId: 'a' }, 0.3),
        entry({ provider: 'anthropic', accountId: 'b' }, 0.9),
      ),
    );
    for (const requestedSource of ['turn_override', 'session', 'agent_config']) {
      const d = await applyCapacityRouting({ ...input, requestedSource, currentAccountId: 'a' });
      expect(d?.route).toEqual(OPUS);
      expect(d?.routeChanged).toBe(false);
      expect(d?.accountId).toBe('b');
    }
  });

  it('pinned source on a low provider is not rerouted', async () => {
    process.env.AGENT_DECISION_CAPACITY_ROUTING = 'on';
    getUsageBudget.mockResolvedValue(lowAnthropic);
    const d = await applyCapacityRouting({ ...input, requestedSource: 'session' });
    expect(d?.route).toEqual(OPUS);
  });

  it('keeps a healthy current account when the better one is only marginally ahead', async () => {
    process.env.AGENT_DECISION_CAPACITY_ROUTING = 'on';
    getUsageBudget.mockResolvedValue(
      snap(
        entry({ provider: 'anthropic', accountId: 'a' }, 0.6),
        entry({ provider: 'anthropic', accountId: 'b' }, 0.65),
      ),
    );
    const d = await applyCapacityRouting({ ...input, currentAccountId: 'a' });
    expect(d?.accountId).toBe('a');
  });

  it('never throws', async () => {
    process.env.AGENT_DECISION_CAPACITY_ROUTING = 'on';
    getUsageBudget.mockRejectedValue(new Error('boom'));
    expect(await applyCapacityRouting(input)).toBeNull();
  });
});

describe('session account auto-pick', () => {
  it('autoPickAccountId only acts in on mode', async () => {
    getUsageBudget.mockResolvedValue(
      snap(
        entry({ provider: 'anthropic', accountId: 'a', isDefault: true }, 0.2),
        entry({ provider: 'anthropic', accountId: 'b' }, 0.9),
      ),
    );
    process.env.AGENT_DECISION_CAPACITY_ROUTING = 'shadow';
    expect(await autoPickAccountId('anthropic')).toBeNull();
    process.env.AGENT_DECISION_CAPACITY_ROUTING = 'on';
    expect(await autoPickAccountId('anthropic')).toBe('b');
    expect(await autoPickAccountId('openai')).toBeNull();
  });

  it('tracks auto-picked sessions per provider', () => {
    markAutoAccountSession('s1', 'anthropic');
    expect(isAutoAccountSession('s1', 'anthropic')).toBe(true);
    expect(isAutoAccountSession('s1', 'openai')).toBe(false);
    markAutoAccountSession('s2');
    expect(isAutoAccountSession('s2', 'openai')).toBe(true);
  });
});

describe('applyCapacityRouting with Auto (router) sessions', () => {
  const lowAnthropic = snap(
    entry({ provider: 'anthropic', accountId: 'a' }, 0.05),
    entry({ provider: 'openrouter' }, 0.7),
  );
  const input = {
    agentId: 'claude-code',
    baseRoute: OPUS,
    requiredTier: 'frontier' as const,
    requestedSource: 'auto',
    authedProviders: ['anthropic', 'openrouter'],
  };

  it('unset env: auto sessions only shadow (log, no change); on requires explicit setting', async () => {
    getUsageBudget.mockResolvedValue(lowAnthropic);
    expect(await applyCapacityRouting(input)).toBeNull();
    expect(listDecisions({ feature: 'capacity_routing' })).toHaveLength(0);
    expect(await applyCapacityRouting({ ...input, sessionAuto: true, currentAccountId: 'a' })).toBeNull();
    const rows = listDecisions({ feature: 'capacity_routing' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ mode: 'shadow', applied: false });
  });

  it('explicit off wins over sessionAuto', async () => {
    process.env.AGENT_DECISION_CAPACITY_ROUTING = 'off';
    getUsageBudget.mockResolvedValue(lowAnthropic);
    expect(await applyCapacityRouting({ ...input, sessionAuto: true })).toBeNull();
    expect(await autoPickAccountId('anthropic', { sessionAuto: true })).toBeNull();
    expect(getUsageBudget).not.toHaveBeenCalled();
  });

  it('autoPickAccountId stays null for auto sessions in shadow (env unset)', async () => {
    getUsageBudget.mockResolvedValue(
      snap(
        entry({ provider: 'anthropic', accountId: 'a' }, 0.3),
        entry({ provider: 'anthropic', accountId: 'b' }, 0.9),
      ),
    );
    expect(await autoPickAccountId('anthropic')).toBeNull();
    expect(await autoPickAccountId('anthropic', { sessionAuto: true })).toBeNull();
    process.env.AGENT_DECISION_CAPACITY_ROUTING = 'on';
    expect(await autoPickAccountId('anthropic', { sessionAuto: true })).toBe('b');
  });
});

describe('cache self-priming', () => {
  const input = {
    agentId: 'claude-code',
    baseRoute: OPUS,
    requiredTier: 'frontier' as const,
    requestedSource: 'agent_default',
    authedProviders: ['anthropic', 'openrouter'],
  };

  it('an empty cache triggers exactly one non-blocking background refresh', async () => {
    process.env.AGENT_DECISION_CAPACITY_ROUTING = 'on';
    let release: (s: UsageBudgetSnapshot) => void = () => undefined;
    getUsageBudget.mockImplementation((opts?: { cachedOnly?: boolean }) =>
      opts?.cachedOnly ? Promise.resolve(snap()) : new Promise<UsageBudgetSnapshot>((r) => { release = r; }),
    );
    // The refresh never resolves until released; the turn path must not wait on it.
    expect(await applyCapacityRouting(input)).toBeNull();
    expect(await applyCapacityRouting(input)).toBeNull();
    const refreshes = getUsageBudget.mock.calls.filter((c) => !c[0]?.cachedOnly);
    expect(refreshes).toHaveLength(1);
    release(snap());
  });

  it('a stale snapshot is used as-is and also refreshed', async () => {
    process.env.AGENT_DECISION_CAPACITY_ROUTING = 'on';
    getUsageBudget.mockImplementation((opts?: { cachedOnly?: boolean }) =>
      Promise.resolve(opts?.cachedOnly ? snap(entry({ provider: 'anthropic', accountId: 'a' }, 0.6)) : snap()),
    );
    const d = await applyCapacityRouting(input);
    expect(d?.accountId).toBe('a');
    expect(getUsageBudget.mock.calls.filter((c) => !c[0]?.cachedOnly)).toHaveLength(1);
  });

  it('a fresh snapshot does not refresh', async () => {
    process.env.AGENT_DECISION_CAPACITY_ROUTING = 'on';
    const fresh = { ...snap(entry({ provider: 'anthropic', accountId: 'a' }, 0.6)), fetchedAt: new Date().toISOString() };
    getUsageBudget.mockResolvedValue(fresh);
    await applyCapacityRouting(input);
    expect(getUsageBudget.mock.calls.filter((c) => !c[0]?.cachedOnly)).toHaveLength(0);
  });
});

describe('cross-agent tier equivalence', () => {
  const TERRA = { providerID: 'openai', modelID: 'gpt-5.6-terra' };
  const authedProviders = ['anthropic', 'openai'];

  it('all accounts low, standard job: sonnet at 9.9% beats terra at 6.5%', () => {
    const r = chooseCapacityRoute({
      agentId: 'claude-code',
      requiredTier: 'standard',
      baseRoute: SONNET,
      authedProviders,
      snapshot: snap(
        entry({ provider: 'anthropic', accountId: 'a1' }, 0.099),
        entry({ provider: 'anthropic', accountId: 'a2' }, 0.1),
        entry({ provider: 'openai', accountId: 'o1' }, 0.065),
      ),
    });
    expect(r.route).toEqual(SONNET);
    expect(r.allLow).toBe(true);
    expect(r.accountId).toBe('a2');
  });

  it('anthropic at 3%, openai at 40%, standard job: terra, flagged crossAgent', () => {
    const snapshot = snap(
      entry({ provider: 'anthropic', accountId: 'a1' }, 0.03),
      entry({ provider: 'openai', accountId: 'o1' }, 0.4),
    );
    const r = chooseCapacityRoute({
      agentId: 'claude-code', requiredTier: 'standard', baseRoute: SONNET, authedProviders, snapshot,
    });
    expect(r.route).toEqual(TERRA);
    expect(r.accountId).toBe('o1');
    expect(r.crossAgent).toBe(true);
  });

  it('the flag off restricts candidates to the agent table', () => {
    process.env.AGENT_DECISION_CAPACITY_CROSS_AGENT = 'false';
    const r = chooseCapacityRoute({
      agentId: 'claude-code',
      requiredTier: 'standard',
      baseRoute: SONNET,
      authedProviders,
      snapshot: snap(
        entry({ provider: 'anthropic', accountId: 'a1' }, 0.03),
        entry({ provider: 'openai', accountId: 'o1' }, 0.4),
      ),
    });
    expect(r.route.providerID).not.toBe('openai');
    expect(r.crossAgent).toBeUndefined();
  });

  it('records crossAgent in the decision detail', async () => {
    process.env.AGENT_DECISION_CAPACITY_ROUTING = 'on';
    getUsageBudget.mockResolvedValue(snap(
      entry({ provider: 'anthropic', accountId: 'a1' }, 0.03),
      entry({ provider: 'openai', accountId: 'o1' }, 0.4),
    ));
    const d = await applyCapacityRouting({
      agentId: 'claude-code', baseRoute: SONNET, requiredTier: 'standard',
      requestedSource: 'agent_default', authedProviders,
    });
    expect(d?.route).toEqual(TERRA);
    expect(listDecisions({ feature: 'capacity_routing' })[0].detail).toMatchObject({ crossAgent: true });
  });
});
