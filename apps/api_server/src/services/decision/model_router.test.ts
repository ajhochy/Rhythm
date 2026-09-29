import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';

import { runMigrations } from '../../database/migrations';
import { setDb } from '../../database/db';
import type { RerankClient } from './decision_client';
import { setRerankClientForTests } from './decision_client';
import { listDecisions } from './decision_log';
import { routeTurnTier } from './model_router';

const ENV = ['AGENT_DECISION_MODEL_ROUTING', 'AGENT_DECISION_ROUTING_MIN_CONFIDENCE'];
let saved: Record<string, string | undefined>;
let db: Database.Database;
let prev: Database.Database | null;

function fake(scores: number[]) {
  const rerank = vi.fn(async () => ({ status: 'ok' as const, scores, latencyMs: 2, model: 'fake' }));
  const client: RerankClient = { rerank };
  return { client, rerank };
}
const base = { prompt: 'redesign the whole auth system', agentId: 'claude-code', requestedSource: 'agent_default' };

beforeEach(() => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  db = new Database(':memory:');
  runMigrations(db);
  prev = setDb(db);
});
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  setRerankClientForTests(null);
  setDb(prev);
  db.close();
});

describe('routeTurnTier', () => {
  it('off makes no client call', async () => {
    const { client, rerank } = fake([0.1, 0.2, 0.9]);
    const r = await routeTurnTier({ ...base, client });
    expect(r.tier).toBeNull();
    expect(rerank).not.toHaveBeenCalled();
  });

  it('never reroutes pinned sources', async () => {
    process.env.AGENT_DECISION_MODEL_ROUTING = 'on';
    const { client, rerank } = fake([0.1, 0.2, 0.9]);
    for (const requestedSource of ['turn_override', 'session', 'tier', 'agent_config']) {
      expect((await routeTurnTier({ ...base, requestedSource, client })).tier).toBeNull();
    }
    expect(rerank).not.toHaveBeenCalled();
  });

  it('on: returns tier when confident, null when not', async () => {
    process.env.AGENT_DECISION_MODEL_ROUTING = 'on';
    const hi = await routeTurnTier({ ...base, client: fake([0.1, 0.2, 0.9]).client });
    expect(hi).toMatchObject({ tier: 'frontier', applied: true });
    const lo = await routeTurnTier({ ...base, client: fake([0.1, 0.2, 0.3]).client });
    expect(lo).toMatchObject({ tier: null, applied: false, reason: 'low_confidence' });
  });

  it('shadow: returns null but logs with baseline', async () => {
    process.env.AGENT_DECISION_MODEL_ROUTING = 'shadow';
    const r = await routeTurnTier({ ...base, baselineTier: 'standard', sessionId: 's1', client: fake([0.1, 0.2, 0.9]).client });
    expect(r.tier).toBeNull();
    const rows = listDecisions();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ feature: 'model_routing', mode: 'shadow', chosen: 'frontier', baseline: 'standard', applied: false, sessionId: 's1' });
    expect(rows[0].detail).toMatchObject({ requestedSource: 'agent_default' });
  });

  it('failure and thrown client yield null', async () => {
    process.env.AGENT_DECISION_MODEL_ROUTING = 'on';
    const failing: RerankClient = { rerank: async () => ({ status: 'timeout', reason: 't', latencyMs: 9 }) };
    expect((await routeTurnTier({ ...base, client: failing })).tier).toBeNull();
    const throwing: RerankClient = { rerank: async () => { throw new Error('x'); } };
    expect((await routeTurnTier({ ...base, client: throwing })).tier).toBeNull();
  });
});

describe('routeTurnTier with Auto (router) sessions', () => {
  it('unset env: a non-auto session never calls the client', async () => {
    const { client, rerank } = fake([0.1, 0.2, 0.9]);
    const r = await routeTurnTier({ ...base, client });
    expect(r.mode).toBe('off');
    expect(rerank).not.toHaveBeenCalled();
  });

  it("unset env: requestedSource 'auto' + sessionAuto routes", async () => {
    const { client, rerank } = fake([0.1, 0.2, 0.9]);
    const r = await routeTurnTier({ ...base, requestedSource: 'auto', sessionAuto: true, client });
    expect(r).toMatchObject({ tier: 'frontier', applied: true, mode: 'on' });
    expect(rerank).toHaveBeenCalledTimes(1);
  });

  it('explicit off is a kill switch and shadow stays shadow for auto sessions', async () => {
    const { client, rerank } = fake([0.1, 0.2, 0.9]);
    process.env.AGENT_DECISION_MODEL_ROUTING = 'off';
    const off = await routeTurnTier({ ...base, requestedSource: 'auto', sessionAuto: true, client });
    expect(off).toMatchObject({ tier: null, mode: 'off' });
    expect(rerank).not.toHaveBeenCalled();
    process.env.AGENT_DECISION_MODEL_ROUTING = 'shadow';
    const shadow = await routeTurnTier({ ...base, requestedSource: 'auto', sessionAuto: true, client });
    expect(shadow).toMatchObject({ tier: null, applied: false, mode: 'shadow' });
  });

  it('a turn_override in an auto session is still pinned', async () => {
    const { client, rerank } = fake([0.1, 0.2, 0.9]);
    const r = await routeTurnTier({ ...base, requestedSource: 'turn_override', sessionAuto: true, client });
    expect(r.tier).toBeNull();
    expect(rerank).not.toHaveBeenCalled();
  });
});
