import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { runMigrations } from '../../database/migrations';
import { setDb } from '../../database/db';
import type { RerankClient } from './decision_client';
import { setRerankClientForTests } from './decision_client';
import { listDecisions } from './decision_log';
import { resetDecisionSettingsCacheForTests } from './decision_settings';
import { routeTurnTier } from './model_router';
import type { ChoiceClient } from './systemone_client';

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

  it("unset env: requestedSource 'auto' + sessionAuto shadows (scores, applies nothing)", async () => {
    const { client, rerank } = fake([0.1, 0.2, 0.9]);
    const r = await routeTurnTier({ ...base, requestedSource: 'auto', sessionAuto: true, client });
    expect(r).toMatchObject({ tier: null, applied: false, mode: 'shadow' });
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

describe('routeTurnTier with the systemone backend', () => {
  let dir: string;
  const probs = (cheap: number, standard: number, frontier: number) => ({ cheap, standard, frontier });
  function choice(p: Record<'cheap' | 'standard' | 'frontier', number>, status: 'ok' | 'timeout' = 'ok') {
    const top = (Object.keys(p) as (keyof typeof p)[]).reduce((a, b) => (p[b] > p[a] ? b : a));
    const choose = vi.fn(async () => status === 'ok'
      ? { status: 'ok' as const, choice: top, confidence: p[top], probabilities: p, latencyMs: 345, model: 'kev-4b' }
      : { status: 'timeout' as const, reason: 'timeout_1000ms', latencyMs: 1000 });
    return { client: { choose } as unknown as ChoiceClient, choose };
  }
  function settings(routing: Record<string, unknown> = {}) {
    writeFileSync(process.env.RHYTHM_DECISION_ROUTER_FILE!, JSON.stringify({ backend: 'systemone', routing }));
    resetDecisionSettingsCacheForTests();
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'router-systemone-'));
    process.env.RHYTHM_DECISION_ROUTER_FILE = join(dir, 'decision-router.json');
    process.env.AGENT_DECISION_MODEL_ROUTING = 'on';
    settings();
  });
  afterEach(() => {
    delete process.env.RHYTHM_DECISION_ROUTER_FILE;
    resetDecisionSettingsCacheForTests();
    rmSync(dir, { recursive: true, force: true });
  });

  it('classifies with one choice call using the tier options and never the reranker', async () => {
    const { client, choose } = choice(probs(0.05, 0.15, 0.8));
    const reranker = fake([0.1, 0.2, 0.9]);
    const r = await routeTurnTier({ ...base, choiceClient: client });
    expect(choose).toHaveBeenCalledTimes(1);
    expect(reranker.rerank).not.toHaveBeenCalled();
    const [state, question] = choose.mock.calls[0] as unknown as [string, { options: Record<string, string>; instructions: string }];
    expect(state).toBe(base.prompt);
    expect(Object.keys(question.options)).toEqual(['cheap', 'standard', 'frontier']);
    expect(question.instructions).toMatch(/not by its length or its topic/);
    expect(r).toMatchObject({ tier: 'frontier', applied: true, reason: 'ok', confidence: 0.8 });
    const [row] = listDecisions();
    expect(row).toMatchObject({ chosen: 'frontier', confidence: 0.8, model: 'kev-4b', latencyMs: 345, applied: true });
    expect(row.detail).toMatchObject({ scores: probs(0.05, 0.15, 0.8) });
  });

  it("low confidence routes to standard by default ('standard' policy) and logs the fallback", async () => {
    const r = await routeTurnTier({ ...base, choiceClient: choice(probs(0.1, 0.4, 0.5)).client });
    expect(r).toMatchObject({ tier: 'standard', applied: true, reason: 'low_confidence_fallback' });
    const [row] = listDecisions();
    expect(row).toMatchObject({ chosen: 'standard', applied: true });
    expect(row.detail).toMatchObject({ reason: 'low_confidence_fallback', classified: 'frontier' });
  });

  it("'keep' leaves a low-confidence route alone", async () => {
    settings({ lowConfidenceTier: 'keep' });
    const r = await routeTurnTier({ ...base, choiceClient: choice(probs(0.1, 0.4, 0.5)).client });
    expect(r).toMatchObject({ tier: null, applied: false, reason: 'low_confidence' });
  });

  it('honours a saved minConfidence', async () => {
    settings({ minConfidence: 0.4, lowConfidenceTier: 'keep' });
    const r = await routeTurnTier({ ...base, choiceClient: choice(probs(0.1, 0.4, 0.5)).client });
    expect(r).toMatchObject({ tier: 'frontier', applied: true });
  });

  it('never overrides a pin', async () => {
    const { client, choose } = choice(probs(0.9, 0.05, 0.05));
    for (const requestedSource of ['turn_override', 'session', 'tier', 'agent_config']) {
      expect((await routeTurnTier({ ...base, requestedSource, choiceClient: client })).tier).toBeNull();
    }
    expect(choose).not.toHaveBeenCalled();
  });

  it('shadow never applies, even for the low-confidence fallback', async () => {
    process.env.AGENT_DECISION_MODEL_ROUTING = 'shadow';
    for (const p of [probs(0.9, 0.05, 0.05), probs(0.1, 0.4, 0.5)]) {
      const r = await routeTurnTier({ ...base, choiceClient: choice(p).client });
      expect(r).toMatchObject({ tier: null, applied: false, reason: 'shadow' });
    }
    expect(listDecisions().every((row) => row.applied === false)).toBe(true);
  });

  it('engine down keeps the baseline route', async () => {
    const r = await routeTurnTier({ ...base, baselineTier: 'standard', choiceClient: choice(probs(1, 0, 0), 'timeout').client });
    expect(r).toMatchObject({ tier: null, applied: false, reason: 'timeout' });
    const throwing = { choose: async () => { throw new Error('x'); } } as unknown as ChoiceClient;
    expect((await routeTurnTier({ ...base, choiceClient: throwing })).tier).toBeNull();
  });

  it('the scope gate still decides, with the fallback tier', async () => {
    const gate = vi.fn(() => ({ apply: false, reason: 'below_escalate_confidence' }));
    const r = await routeTurnTier({ ...base, choiceClient: choice(probs(0.1, 0.4, 0.5)).client, scopeGate: gate });
    expect(gate).toHaveBeenCalledWith('standard', 0.5);
    expect(r).toMatchObject({ tier: null, applied: false, reason: 'scope:below_escalate_confidence' });
  });
});
