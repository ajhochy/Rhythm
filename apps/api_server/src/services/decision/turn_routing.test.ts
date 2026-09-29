import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../opencode_engine', () => ({
  opencodeClient: {
    listAuthedProviders: vi.fn().mockResolvedValue(['anthropic', 'openai']),
    isProviderInAuthStore: () => true,
    providerSnapshot: vi.fn().mockResolvedValue({ providers: [] }),
  },
}));

import { setDb } from '../../database/db';
import { runMigrations } from '../../database/migrations';
import { AgentSessionsRepository } from '../../repositories/agent_sessions_repository';
import { resetDecisionSettingsCacheForTests } from './decision_settings';
import type { RerankClient } from './decision_client';
import { listDecisions } from './decision_log';
import { routeTurnForSession } from './turn_routing';

const ENV = [
  'RHYTHM_DECISION_ROUTER_FILE', 'AGENT_DECISION_MODEL_ROUTING', 'AGENT_DECISION_CAPACITY_ROUTING',
  'AGENT_DECISION_ROUTING_SCOPE', 'AGENT_DECISION_ESCALATE_MIN_CONFIDENCE',
];
let saved: Record<string, string | undefined>;
let db: Database.Database;
let prev: Database.Database | null;

// scores are aligned to [cheap, standard, frontier]
const fake = (scores: number[]) => {
  const rerank = vi.fn(async () => ({ status: 'ok' as const, scores, latencyMs: 1, model: 'fake' }));
  return { client: { rerank } as RerankClient, rerank };
};
const SONNET = { providerID: 'anthropic', modelID: 'claude-sonnet-4-6' };

function makeSession(mode: 'auto' | 'fixed' = 'auto') {
  const repo = new AgentSessionsRepository();
  const s = repo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: 's', modelMode: mode });
  repo.updateFields(s.id, { providerId: SONNET.providerID, modelId: SONNET.modelID });
  return s;
}
const run = (id: string, client: RerankClient, baseRoute = SONNET) => {
  const repo = new AgentSessionsRepository();
  const row = repo.findById(id)!;
  return routeTurnForSession({
    sessionRow: row,
    sessionId: id,
    prompt: 'redesign the whole auth architecture',
    agentId: 'claude-code',
    requestedSource: 'auto',
    baseRoute: { providerID: row.providerId ?? baseRoute.providerID, modelID: row.modelId ?? baseRoute.modelID },
    sessionAuto: row.modelMode === 'auto',
    client,
  });
};

beforeEach(() => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  process.env.RHYTHM_DECISION_ROUTER_FILE = '/nonexistent/decision-router.json';
  process.env.AGENT_DECISION_MODEL_ROUTING = 'on';
  process.env.AGENT_DECISION_CAPACITY_ROUTING = 'off';
  delete process.env.AGENT_DECISION_ROUTING_SCOPE;
  delete process.env.AGENT_DECISION_ESCALATE_MIN_CONFIDENCE;
  resetDecisionSettingsCacheForTests();
  db = new Database(':memory:');
  runMigrations(db);
  prev = setDb(db);
});
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  resetDecisionSettingsCacheForTests();
  setDb(prev);
  db.close();
});

describe('routeTurnForSession scope', () => {
  it('first_prompt (default): first prompt routes + persists, second skips the reranker entirely', async () => {
    const s = makeSession();
    const first = fake([0.05, 0.1, 0.95]);
    const r1 = await run(s.id, first.client);
    expect(r1).toMatchObject({ applied: true, source: 'router', requestedSource: 'tier', requestedTier: 'frontier' });
    const row = new AgentSessionsRepository().findById(s.id)!;
    expect(row.modelMode).toBe('auto');
    expect(row.routerDecidedAt).toBeTruthy();
    expect(row.modelId).toBe(r1.route?.modelID);
    expect(classifyOf(row.modelId!)).toBe('frontier');

    const logRows = listDecisions({}).length;
    const second = fake([0.9, 0.05, 0.05]);
    const r2 = await run(s.id, second.client);
    expect(second.rerank).not.toHaveBeenCalled();
    expect(listDecisions({}).length).toBe(logRows);
    expect(r2.applied).toBe(false);
    expect(r2.route?.modelID).toBe(row.modelId);
  });

  it('escalate_only: moves up when confident, never down', async () => {
    process.env.AGENT_DECISION_ROUTING_SCOPE = 'escalate_only';
    const s = makeSession();
    const up = fake([0.02, 0.05, 0.95]);
    expect((await run(s.id, up.client)).applied).toBe(true);
    const down = fake([0.95, 0.03, 0.02]);
    const r = await run(s.id, down.client);
    expect(down.rerank).toHaveBeenCalled();
    expect(r.applied).toBe(false);
    expect(classifyOf(new AgentSessionsRepository().findById(s.id)!.modelId!)).toBe('frontier');
  });

  it('escalate_only: below escalateMin confidence does not apply or persist', async () => {
    process.env.AGENT_DECISION_ROUTING_SCOPE = 'escalate_only';
    process.env.AGENT_DECISION_ESCALATE_MIN_CONFIDENCE = '0.99';
    const s = makeSession();
    const r = await run(s.id, fake([0.02, 0.05, 0.95]).client);
    expect(r.applied).toBe(false);
    expect(new AgentSessionsRepository().findById(s.id)!.routerDecidedAt).toBeNull();
  });

  it('every_prompt routes each time and persists nothing', async () => {
    process.env.AGENT_DECISION_ROUTING_SCOPE = 'every_prompt';
    const s = makeSession();
    const f = fake([0.02, 0.05, 0.95]);
    expect((await run(s.id, f.client)).applied).toBe(true);
    expect((await run(s.id, f.client)).applied).toBe(true);
    expect(f.rerank).toHaveBeenCalledTimes(2);
    const row = new AgentSessionsRepository().findById(s.id)!;
    expect(row.routerDecidedAt).toBeNull();
    expect(row.modelId).toBe(SONNET.modelID);
  });

  it('shadow logs a would-apply flag but persists nothing and keeps the route', async () => {
    process.env.AGENT_DECISION_MODEL_ROUTING = 'shadow';
    const s = makeSession();
    const r = await run(s.id, fake([0.02, 0.05, 0.95]).client);
    expect(r.applied).toBe(false);
    expect(r.route).toEqual(SONNET);
    const row = new AgentSessionsRepository().findById(s.id)!;
    expect(row.routerDecidedAt).toBeNull();
    expect(row.modelId).toBe(SONNET.modelID);
    const log = listDecisions({}).find((d) => d.feature === 'model_routing')!;
    expect(log.applied).toBe(false);
    expect(JSON.stringify(log.detail)).toContain('"wouldApply":true');
  });

  it('PATCH-style modelMode:auto clears router_decided_at so the next prompt routes again', async () => {
    const s = makeSession();
    await run(s.id, fake([0.02, 0.05, 0.95]).client);
    const repo = new AgentSessionsRepository();
    expect(repo.findById(s.id)!.routerDecidedAt).toBeTruthy();
    repo.updateFields(s.id, { modelMode: 'auto' });
    expect(repo.findById(s.id)!.routerDecidedAt).toBeNull();
    const again = fake([0.02, 0.05, 0.95]);
    await run(s.id, again.client);
    expect(again.rerank).toHaveBeenCalled();
  });
});

import { classifyRouteTier } from '../agent_model_resolver';
function classifyOf(modelID: string) {
  return classifyRouteTier({ providerID: 'anthropic', modelID });
}
