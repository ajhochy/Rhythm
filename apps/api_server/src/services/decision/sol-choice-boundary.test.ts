import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '../../database/migrations';
import { setDb } from '../../database/db';
import { listDecisions } from './decision_log';
import { resetDecisionSettingsCacheForTests } from './decision_settings';
import { routeTurnTier, waitForShadowRoutingForTests } from './model_router';
import type { ChoiceClient } from './systemone_client';
// Routing inputs are real; only the out-of-scope catalog can never run/network.
vi.mock('./model_catalog', () => ({ routeModelForTier: async () => { throw new Error('unexpected downstream catalog'); } }));
let db: Database.Database;
let prev: Database.Database | null;
let dir: string;
let saved: Record<string, string | undefined>;
const keys = ['RHYTHM_DECISION_ROUTER_FILE', 'AGENT_DECISION_ROUTING_MIN_CONFIDENCE'];
beforeEach(() => {
  saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  dir = mkdtempSync(join(tmpdir(), 'sol-router-boundary-'));
  process.env.RHYTHM_DECISION_ROUTER_FILE = join(dir, 'settings.json');
  process.env.AGENT_DECISION_ROUTING_MIN_CONFIDENCE = '0.55';
  writeFileSync(process.env.RHYTHM_DECISION_ROUTER_FILE, JSON.stringify({ backend: 'systemone' }));
  resetDecisionSettingsCacheForTests();
  db = new Database(':memory:'); runMigrations(db); prev = setDb(db);
});
afterEach(async () => {
  await waitForShadowRoutingForTests();
  setDb(prev); db.close();
  for (const k of keys) saved[k] === undefined ? delete process.env[k] : process.env[k] = saved[k];
  resetDecisionSettingsCacheForTests(); rmSync(dir, { recursive: true, force: true });
});
const baseline = { prompt: 'Synthetic classification evidence', agentId: 'claude-code', requestedSource: 'auto', baselineTier: 'standard' as const };
const normal = { status: 'ok', choice: 'frontier', confidence: 0.8, probabilities: { cheap: 0.05, standard: 0.15, frontier: 0.8 }, latencyMs: 25, model: 'synthetic' };
function client(over: Record<string, unknown> = {}): ChoiceClient {
  return { choose: vi.fn(async () => ({ ...normal, ...over })) } as unknown as ChoiceClient;
}
describe('Sol actual ChoiceClient boundary', () => {
  for (const [name, over] of [
    ['zero-total forged confidence', { probabilities: { cheap: 0, standard: 0, frontier: 0 }, confidence: 0.9 }],
    ['unnormalized low total reaches standard fallback', { probabilities: { cheap: 0.1, standard: 0.1, frontier: 0.1 }, confidence: 0.1 }],
    ['unnormalized high total reaches standard fallback', { probabilities: { cheap: 0.5, standard: 0.5, frontier: 0.5 }, confidence: 0.5 }],
    ['choice is not probability winner', { probabilities: { cheap: 0.8, standard: 0.1, frontier: 0.1 }, choice: 'frontier', confidence: 0.8 }],
    ['confidence differs from top probability', { confidence: 0.99 }],
  ] as const) {
    for (const modeOverride of ['shadow', 'on'] as const) {
    it(name + ' must be held in ' + modeOverride, async () => {
        db.exec('DELETE FROM agent_decision_log');
        const result = await routeTurnTier({ ...baseline, modeOverride, choiceClient: client(over) });
        expect(result).toMatchObject({ tier: null, applied: false, reason: modeOverride === 'shadow' ? 'shadow' : 'error' });
        await waitForShadowRoutingForTests();
        const row = listDecisions()[0];
        expect(row).toMatchObject({ status: 'error', detail: { reason: 'malformed_response' } });
        expect(row.chosen ?? null).toBeNull();
    });
    }
  }
  for (const extra of [9, NaN]) {
    it(`unknown extra ${extra} cannot affect required-tier margin`, async () => {
      const result = await routeTurnTier({ ...baseline, modeOverride: 'shadow', choiceClient: client({ probabilities: { ...normal.probabilities, unknown: extra } }) });
      expect(result).toMatchObject({ tier: null, applied: false, reason: 'shadow' });
      await waitForShadowRoutingForTests();
      expect(listDecisions()[0].confidence).toBe(0.8);
      expect(listDecisions()[0].detail.margin).toBeCloseTo(0.65);
      expect(listDecisions()[0].detail.scores).toEqual(normal.probabilities);
    });
  }
  it('valid evidence preserves threshold, default fallback, keep, latency and Shadow', async () => {
    for (const c of [0.5499, 0.55, 0.5501]) {
      db.exec('DELETE FROM agent_decision_log');
      const gate = vi.fn(() => ({ apply: false, reason: 'synthetic-no-catalog' }));
      const result = await routeTurnTier({ ...baseline, modeOverride: 'on', choiceClient: client({ confidence: c, probabilities: { cheap: (1-c)/2, standard: (1-c)/2, frontier: c } }), scopeGate: gate });
      expect(gate).toHaveBeenCalledWith(c < 0.55 ? 'standard' : 'frontier', c);
      expect(result.applied).toBe(false); expect(listDecisions()[0].latencyMs).toBe(25);
    }
    writeFileSync(process.env.RHYTHM_DECISION_ROUTER_FILE!, JSON.stringify({ backend: 'systemone', routing: { lowConfidenceTier: 'keep' } }));
    resetDecisionSettingsCacheForTests(); db.exec('DELETE FROM agent_decision_log');
    expect(await routeTurnTier({ ...baseline, modeOverride: 'shadow', choiceClient: client({ confidence: 0.4, probabilities: { cheap: 0.3, standard: 0.3, frontier: 0.4 } }) })).toMatchObject({ tier: null, applied: false, reason: 'shadow' });
    await waitForShadowRoutingForTests();
    expect(listDecisions()[0].chosen).toBe('frontier');
  });
  it('explicit Astra session pin never calls classifier', async () => {
    const choiceClient = client();
    expect(await routeTurnTier({ ...baseline, agentId: 'gpt-6-astra', requestedSource: 'session_override', modeOverride: 'on', choiceClient })).toMatchObject({ tier: null, applied: false, reason: 'pinned_source' });
    expect(choiceClient.choose).not.toHaveBeenCalled();
  });
});
