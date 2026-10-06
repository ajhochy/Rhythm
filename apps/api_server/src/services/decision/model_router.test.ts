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
let savedRouterFile: string | undefined;
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
  // Never read the host's saved Router settings (Shadow/systemone) into these tests.
  savedRouterFile = process.env.RHYTHM_DECISION_ROUTER_FILE;
  process.env.RHYTHM_DECISION_ROUTER_FILE = join(tmpdir(), 'router-test-no-settings', 'decision-router.json');
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
  if (savedRouterFile === undefined) delete process.env.RHYTHM_DECISION_ROUTER_FILE;
  else process.env.RHYTHM_DECISION_ROUTER_FILE = savedRouterFile;
  resetDecisionSettingsCacheForTests();
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

  const asClient = (result: unknown) => ({ choose: vi.fn(async () => result) }) as unknown as ChoiceClient & { choose: ReturnType<typeof vi.fn> };
  const okResult = (over: Record<string, unknown> = {}) => ({
    status: 'ok', choice: 'frontier', confidence: 0.8, probabilities: probs(0.05, 0.15, 0.8), latencyMs: 25, model: 'kev-4b', ...over,
  });
  const expectBaseline = (r: Awaited<ReturnType<typeof routeTurnTier>>) => {
    expect(r).toMatchObject({ tier: null, applied: false, reason: 'error' });
    expect(r.route).toBeUndefined();
    expect(r.confidence).toBeUndefined();
    const rows = listDecisions();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'error', applied: false, baseline: 'standard' });
    expect(rows[0].chosen ?? null).toBeNull();
    expect(rows[0].confidence ?? null).toBeNull();
    expect(rows[0].detail).toMatchObject({ reason: 'malformed_response' });
  };

  it('R1: a nominal success with an unusable confidence or probabilities keeps the baseline in shadow and on', async () => {
    const gate = vi.fn(() => ({ apply: true, reason: 'ok' }));
    const bad = [
      { confidence: undefined }, { confidence: null }, { confidence: NaN }, { confidence: Infinity },
      { confidence: -Infinity }, { confidence: -1 }, { confidence: 1.1 }, { confidence: '0.9' },
      { probabilities: undefined }, { probabilities: null }, { probabilities: { cheap: 0.1, standard: 0.2 } },
      { probabilities: probs(NaN, 0.2, 0.8) }, { probabilities: probs(0.1, Infinity, 0.8) }, { probabilities: probs(0.1, 0.2, null as unknown as number) },
      { choice: 'huge' },
    ];
    for (const over of bad) {
      for (const modeOverride of ['shadow', 'on'] as const) {
        db.exec('DELETE FROM agent_decision_log');
        const r = await routeTurnTier({ ...base, baselineTier: 'standard', modeOverride, scopeGate: gate, choiceClient: asClient(okResult(over)) });
        expectBaseline(r);
      }
    }
    expect(gate).not.toHaveBeenCalled();
  });

  it('R2: the real SystemOneClient fed missing or overflowing probabilities falls back to the baseline', async () => {
    const { SystemOneClient } = await import('./systemone_client');
    const bodies = [
      '{"answers":{"q":{"choice":"frontier"}}}',
      '{"answers":{"q":{"choice":"frontier","probabilities":null}}}',
      '{"answers":{"q":{"choice":"frontier","probabilities":{"cheap":1e309,"standard":0,"frontier":0}}}}',
      `{"answers":{"q":{"choice":"frontier","probabilities":{"cheap":${Number.MAX_VALUE},"standard":${Number.MAX_VALUE},"frontier":0}}}}`,
    ];
    for (const body of bodies) {
      db.exec('DELETE FROM agent_decision_log');
      const fetchImpl = vi.fn(async () => new Response(body, { status: 200 }));
      const choiceClient = new SystemOneClient({ baseUrl: 'http://127.0.0.1:8009', model: 'kev-latest', consent: false, fetchImpl });
      expectBaseline(await routeTurnTier({ ...base, baselineTier: 'standard', modeOverride: 'on', choiceClient }));
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });

  it('R3: threshold boundary .5499 / .55 / .5501 with default and keep policies', async () => {
    const at = (c: number) => choice(probs((1 - c) / 2, (1 - c) / 2, c)).client;
    // default 'standard' policy
    expect(await routeTurnTier({ ...base, choiceClient: at(0.5499) })).toMatchObject({ tier: 'standard', reason: 'low_confidence_fallback' });
    expect(await routeTurnTier({ ...base, choiceClient: at(0.55) })).toMatchObject({ tier: 'frontier', reason: 'ok' });
    expect(await routeTurnTier({ ...base, choiceClient: at(0.5501) })).toMatchObject({ tier: 'frontier', reason: 'ok' });
    settings({ lowConfidenceTier: 'keep' });
    expect(await routeTurnTier({ ...base, choiceClient: at(0.5499) })).toMatchObject({ tier: null, applied: false, reason: 'low_confidence' });
    expect(await routeTurnTier({ ...base, choiceClient: at(0.55) })).toMatchObject({ tier: 'frontier', applied: true });
  });

  it('R4: shadow and a closed scope gate never apply, valid high or low confidence', async () => {
    process.env.AGENT_DECISION_MODEL_ROUTING = 'shadow';
    for (const p of [probs(0.9, 0.05, 0.05), probs(0.3, 0.3, 0.4)]) {
      expect(await routeTurnTier({ ...base, choiceClient: choice(p).client })).toMatchObject({ tier: null, applied: false });
    }
    process.env.AGENT_DECISION_MODEL_ROUTING = 'on';
    const gate = vi.fn(() => ({ apply: false, reason: 'closed' }));
    for (const p of [probs(0.05, 0.15, 0.8), probs(0.3, 0.3, 0.4)]) {
      expect(await routeTurnTier({ ...base, choiceClient: choice(p).client, scopeGate: gate }))
        .toMatchObject({ tier: null, applied: false, reason: 'scope:closed' });
    }
    expect(listDecisions().every((row) => row.applied === false)).toBe(true);
  });

  it('R5: every explicit pin (including a pinned Astra), empty prompt and mode off skip the classifier', async () => {
    const c = asClient(okResult());
    for (const requestedSource of ['turn_override', 'session', 'tier', 'agent_config', 'explicit', 'astra']) {
      expect(await routeTurnTier({ ...base, requestedSource, choiceClient: c })).toMatchObject({ tier: null, applied: false, reason: 'pinned_source' });
    }
    expect(await routeTurnTier({ ...base, prompt: '   ', choiceClient: c })).toMatchObject({ tier: null, reason: 'empty_prompt' });
    expect(await routeTurnTier({ ...base, modeOverride: 'off', choiceClient: c })).toMatchObject({ tier: null, mode: 'off', reason: 'off' });
    expect(c.choose).not.toHaveBeenCalled();
    expect(listDecisions()).toHaveLength(0);
  });

  it('R6: timeout, refusal, 503, malformed JSON, oversized body and redirect keep the baseline without fallback', async () => {
    const { SystemOneClient } = await import('./systemone_client');
    const cases: [string, () => Promise<Response>][] = [
      ['http_503', async () => new Response('no', { status: 503 })],
      ['malformed_json', async () => new Response('{nope', { status: 200 })],
      ['response_too_large', async () => new Response('x'.repeat(1_000_001), { status: 200 })],
      ['http_302', async () => new Response(null, { status: 302, headers: { location: 'http://evil.example/' } })],
      ['request_failed', async () => { throw new Error('ECONNREFUSED'); }],
      ['timeout_20ms', (): Promise<Response> => new Promise(() => undefined)],
    ];
    for (const [reason, respond] of cases) {
      db.exec('DELETE FROM agent_decision_log');
      const fetchImpl = vi.fn((_u: string, init?: RequestInit) => reason.startsWith('timeout')
        ? new Promise<Response>((_res, rej) => init?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('t'), { name: 'TimeoutError' }))))
        : respond());
      const choiceClient = new SystemOneClient({ baseUrl: 'http://127.0.0.1:8009', model: 'm', consent: false, fetchImpl, timeoutMs: 20 });
      const r = await routeTurnTier({ ...base, baselineTier: 'standard', modeOverride: 'on', choiceClient });
      expect(r, reason).toMatchObject({ tier: null, applied: false });
      expect(r.reason, reason).toMatch(/^(error|timeout)$/);
      const [row] = listDecisions();
      expect(row, reason).toMatchObject({ applied: false, detail: { reason } });
      expect(row.chosen ?? null, reason).toBeNull();
      expect(row.latencyMs, reason).toEqual(expect.any(Number));
    }
  });

  it('R7: logged latency is the measured value, or null when unknown or invalid', async () => {
    for (const [latencyMs, expected] of [[25, 25], [undefined, null], [NaN, null], [Infinity, null], [-5, null]] as const) {
      db.exec('DELETE FROM agent_decision_log');
      const r = await routeTurnTier({ ...base, choiceClient: asClient(okResult({ latencyMs })) });
      expect(r).toMatchObject({ tier: 'frontier', applied: true });
      expect(listDecisions()[0].latencyMs).toBe(expected);
    }
  });

  it('the scope gate still decides, with the fallback tier', async () => {
    const gate = vi.fn(() => ({ apply: false, reason: 'below_escalate_confidence' }));
    const r = await routeTurnTier({ ...base, choiceClient: choice(probs(0.1, 0.4, 0.5)).client, scopeGate: gate });
    expect(gate).toHaveBeenCalledWith('standard', 0.5);
    expect(r).toMatchObject({ tier: null, applied: false, reason: 'scope:below_escalate_confidence' });
  });
});
