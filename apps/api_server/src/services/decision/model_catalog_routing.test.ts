import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const providerSnapshot = vi.fn();
vi.mock('../opencode_engine', () => ({
  opencodeClient: {
    listAuthedProviders: vi.fn().mockResolvedValue(['anthropic', 'openai']),
    isProviderInAuthStore: () => true,
    providerSnapshot: (...a: unknown[]) => providerSnapshot(...a),
  },
}));
const getUsageBudget = vi.fn();
vi.mock('../usage_budget_service', () => ({ getUsageBudget: (...a: unknown[]) => getUsageBudget(...a) }));

import { setDb } from '../../database/db';
import { runMigrations } from '../../database/migrations';
import { AgentSessionsRepository } from '../../repositories/agent_sessions_repository';
import { ROUTE_FALLBACKS_BY_AGENT } from '../agent_model_resolver';
import type { UsageBudgetSnapshot } from '../usage_budget_service';
import { applyCapacityRouting } from './capacity_router';
import type { RerankClient } from './decision_client';
import { listDecisions } from './decision_log';
import { resetDecisionSettingsCacheForTests } from './decision_settings';
import { resetModelCatalogCache } from './model_catalog';
import { routeTurnForSession } from './turn_routing';

const CAPS = { input: { text: true }, output: { text: true }, toolcall: true };
const model = (id: string, out: number, date: string, family: string) => ({
  id, name: id, status: 'active', capabilities: CAPS, cost: { input: out / 5, output: out },
  releaseDate: date, family, reasoning: true,
});
// claude-*-5-x are newest-per-family (policy-visible) and NOT in ROUTE_FALLBACKS_BY_AGENT.
const LIVE = {
  providers: [
    {
      id: 'anthropic', connected: true, digest: 'a',
      models: [
        model('claude-haiku-5-0', 5, '2026-08-15', 'claude-haiku'),
        model('claude-sonnet-5-5', 15, '2026-08-20', 'claude-sonnet'),
        model('claude-opus-5-5', 25, '2026-09-01', 'claude-opus'),
      ],
    },
    {
      id: 'openai', connected: true, digest: 'o',
      models: [
        model('gpt-5.6-luna', 4.5, '2026-08-01', 'gpt-mini'),
        model('gpt-5.6-terra', 15, '2026-08-01', 'gpt'),
        model('gpt-5.6-sol', 30, '2026-08-01', 'gpt-sol'),
      ],
    },
  ],
  defaults: {},
};
const staticModelIds = new Set(Object.values(ROUTE_FALLBACKS_BY_AGENT).flat().map((r) => r.modelID));

const ENV = [
  'RHYTHM_DECISION_ROUTER_FILE', 'AGENT_DECISION_MODEL_ROUTING', 'AGENT_DECISION_CAPACITY_ROUTING',
  'AGENT_DECISION_ROUTING_SCOPE', 'AGENT_DECISION_CAPACITY_CROSS_AGENT',
];
let saved: Record<string, string | undefined>;
let db: Database.Database;
let prev: Database.Database | null;

const setVisible = (provider: string, modelId: string, visible: boolean) =>
  db.prepare('INSERT OR REPLACE INTO agent_model_visibility (provider, model_id, visible) VALUES (?, ?, ?)')
    .run(provider, modelId, visible ? 1 : 0);

const fake = (scores: number[]) => ({
  rerank: vi.fn(async () => ({ status: 'ok' as const, scores, latencyMs: 1, model: 'fake' })),
}) as unknown as RerankClient;

beforeEach(() => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  process.env.RHYTHM_DECISION_ROUTER_FILE = '/nonexistent/decision-router.json';
  process.env.AGENT_DECISION_MODEL_ROUTING = 'on';
  process.env.AGENT_DECISION_CAPACITY_ROUTING = 'off';
  delete process.env.AGENT_DECISION_ROUTING_SCOPE;
  delete process.env.AGENT_DECISION_CAPACITY_CROSS_AGENT;
  resetDecisionSettingsCacheForTests();
  resetModelCatalogCache();
  providerSnapshot.mockReset().mockResolvedValue(LIVE);
  getUsageBudget.mockReset().mockResolvedValue({ providers: [], fetchedAt: '2026-09-29T00:00:00Z' });
  db = new Database(':memory:');
  runMigrations(db);
  prev = setDb(db);
  // Rhythm's Models curation: everything in the live catalog is enabled unless a test says otherwise.
  for (const p of LIVE.providers) for (const m of p.models) setVisible(p.id, m.id, true);
});
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  resetDecisionSettingsCacheForTests();
  resetModelCatalogCache();
  setDb(prev);
  db.close();
});

function session(providerId: string, modelId: string) {
  const repo = new AgentSessionsRepository();
  const s = repo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: 's', modelMode: 'auto' });
  repo.updateFields(s.id, { providerId, modelId });
  return repo.findById(s.id)!;
}
const route = (row: NonNullable<ReturnType<AgentSessionsRepository['findById']>>, scores: number[]) =>
  routeTurnForSession({
    sessionRow: row, sessionId: row.id, prompt: 'redesign the whole auth architecture',
    agentId: 'claude-code', requestedSource: 'auto',
    baseRoute: { providerID: row.providerId!, modelID: row.modelId! },
    sessionAuto: true, client: fake(scores),
  });

describe('router chooses only models enabled in Rhythm curation', () => {
  it('sonnet enabled, opus disabled: a frontier request never picks opus (picks up a visibility change without waiting for the TTL)', async () => {
    const before = await route(session('anthropic', 'claude-sonnet-5-5'), [0.02, 0.05, 0.95]);
    expect(before.route).toEqual({ providerID: 'anthropic', modelID: 'claude-opus-5-5' });
    setVisible('anthropic', 'claude-opus-5-5', false); // PATCH /agent-models/visibility writes this row; no explicit invalidation
    const after = await route(session('anthropic', 'claude-sonnet-5-5'), [0.02, 0.05, 0.95]);
    expect(after.route?.modelID).not.toBe('claude-opus-5-5');
    // the only remaining enabled frontier-band model
    expect(after.route).toEqual({ providerID: 'openai', modelID: 'gpt-5.6-sol' });
  });

  it('a policy-listed model with no curation row is not routable (gpt-5.6-terra)', async () => {
    db.prepare("DELETE FROM agent_model_visibility WHERE model_id = 'gpt-5.6-terra'").run();
    const r = await route(session('openai', 'gpt-5.6-luna'), [0.02, 0.95, 0.03]);
    expect(r.route?.modelID).not.toBe('gpt-5.6-terra');
  });

  it('empty curation: the baseline route is kept (no static fallback) and the reason is logged', async () => {
    db.prepare('DELETE FROM agent_model_visibility').run();
    const r = await route(session('anthropic', 'claude-haiku-5-0'), [0.02, 0.05, 0.95]);
    expect(r.route).toEqual({ providerID: 'anthropic', modelID: 'claude-haiku-5-0' });
    const log = listDecisions({}).find((d) => d.feature === 'model_routing')!;
    expect(log.detail).toMatchObject({ catalog: 'live', routeReason: 'no_curated_models' });
  });
});

describe('router picks from the live catalog, not the hardcoded table', () => {
  it('frontier turn on an anthropic session -> the newest live opus, which is not in ROUTE_FALLBACKS', async () => {
    expect(staticModelIds.has('claude-opus-5-5')).toBe(false);
    expect(staticModelIds.has('claude-sonnet-5-5')).toBe(false);
    const row = session('anthropic', 'claude-sonnet-5-5');
    const r = await route(row, [0.02, 0.05, 0.95]);
    expect(r).toMatchObject({ applied: true, source: 'router', requestedTier: 'frontier' });
    expect(r.route).toEqual({ providerID: 'anthropic', modelID: 'claude-opus-5-5' });
    expect(new AgentSessionsRepository().findById(row.id)!.modelId).toBe('claude-opus-5-5');
    const log = listDecisions({}).find((d) => d.feature === 'model_routing')!;
    expect(log.detail).toMatchObject({ catalog: 'live', pickedModel: 'anthropic/claude-opus-5-5' });
  });

  it('cheap turn stays on the base provider; on an openai session it picks the live openai model', async () => {
    const a = await route(session('anthropic', 'claude-opus-5-5'), [0.95, 0.03, 0.02]);
    expect(a.route).toEqual({ providerID: 'anthropic', modelID: 'claude-haiku-5-0' });
    const b = await route(session('openai', 'gpt-5.6-terra'), [0.95, 0.03, 0.02]);
    expect(b.route).toEqual({ providerID: 'openai', modelID: 'gpt-5.6-luna' });
  });

  it('honours router settings exclusions and tier overrides', async () => {
    const { writeFileSync, mkdtempSync } = await import('fs');
    const { tmpdir } = await import('os');
    const { join } = await import('path');
    const file = join(mkdtempSync(join(tmpdir(), 'mc-')), 'decision-router.json');
    writeFileSync(file, JSON.stringify({ excludedModels: ['anthropic/claude-opus-5-5'], tierOverrides: { 'anthropic/claude-sonnet-5-5': 'frontier' } }));
    process.env.RHYTHM_DECISION_ROUTER_FILE = file;
    resetDecisionSettingsCacheForTests();
    const r = await route(session('anthropic', 'claude-haiku-5-0'), [0.02, 0.05, 0.95]);
    expect(r.route).toEqual({ providerID: 'anthropic', modelID: 'claude-sonnet-5-5' });
  });

  it('empty engine catalog: static table, recorded as catalog static', async () => {
    providerSnapshot.mockResolvedValue({ providers: [], defaults: {} });
    const r = await route(session('anthropic', 'claude-sonnet-5-5'), [0.02, 0.05, 0.95]);
    expect(r.applied).toBe(true);
    expect(staticModelIds.has(r.route!.modelID)).toBe(true);
    expect(listDecisions({}).find((d) => d.feature === 'model_routing')!.detail).toMatchObject({ catalog: 'static' });
  });
});

describe('capacity routing among live models', () => {
  const usage = (anthropic: number, openai: number): UsageBudgetSnapshot => ({
    fetchedAt: new Date().toISOString(),
    providers: [
      { provider: 'anthropic', label: 'a', kind: 'window', items: [{ label: 'w', remainingFraction: anthropic, resetAt: null }], accountId: 'acc', isDefault: true },
      { provider: 'openai', label: 'o', kind: 'window', items: [{ label: 'w', remainingFraction: openai, resetAt: null }] },
    ],
  });
  const apply = (over: Record<string, unknown> = {}) => applyCapacityRouting({
    agentId: 'claude-code',
    baseRoute: { providerID: 'anthropic', modelID: 'claude-opus-5-5' },
    requiredTier: 'frontier',
    requestedSource: 'agent_default',
    modeOverride: 'on',
    ...over,
  });

  it('anthropic nearly out, openai has room: switches to the live frontier-band openai model', async () => {
    getUsageBudget.mockResolvedValue(usage(0.02, 0.6));
    const d = await apply();
    expect(d).toMatchObject({ routeChanged: true, allLow: false });
    expect(d!.route).toEqual({ providerID: 'openai', modelID: 'gpt-5.6-sol' });
    expect(listDecisions({ feature: 'capacity_routing' })[0].detail).toMatchObject({ catalog: 'live' });
  });

  it('a standard job lands on the live standard-band model, never above the required tier by name', async () => {
    getUsageBudget.mockResolvedValue(usage(0.02, 0.6));
    const d = await apply({ requiredTier: 'standard', baseRoute: { providerID: 'anthropic', modelID: 'claude-sonnet-5-5' } });
    expect(d!.route).toEqual({ providerID: 'openai', modelID: 'gpt-5.6-terra' });
  });

  it('everything low: cheapest capable live model', async () => {
    getUsageBudget.mockResolvedValue(usage(0.02, 0.03));
    const d = await apply({ requiredTier: 'cheap', baseRoute: { providerID: 'anthropic', modelID: 'claude-sonnet-5-5' } });
    expect(d).toMatchObject({ allLow: true });
    expect(['claude-haiku-5-0', 'gpt-5.6-luna']).toContain(d!.route.modelID);
  });

  it('AGENT_DECISION_CAPACITY_CROSS_AGENT=false keeps candidates on the agent\'s own providers', async () => {
    process.env.AGENT_DECISION_CAPACITY_CROSS_AGENT = 'false';
    getUsageBudget.mockResolvedValue(usage(0.02, 0.6));
    const d = await apply();
    expect(d!.route.providerID).toBe('anthropic');
  });

  it('empty engine catalog: static table with catalog static in the detail', async () => {
    providerSnapshot.mockResolvedValue({ providers: [], defaults: {} });
    getUsageBudget.mockResolvedValue(usage(0.02, 0.6));
    await apply({ authedProviders: ['anthropic', 'openai'], baseRoute: { providerID: 'anthropic', modelID: 'claude-opus-4-7' } });
    expect(listDecisions({ feature: 'capacity_routing' })[0].detail).toMatchObject({ catalog: 'static' });
  });
});
