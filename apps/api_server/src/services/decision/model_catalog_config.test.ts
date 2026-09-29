import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../middleware/auth_middleware', () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
const providerSnapshot = vi.fn();
vi.mock('../opencode_engine', () => ({
  opencodeClient: {
    providerSnapshot: (...a: unknown[]) => providerSnapshot(...a),
    listAuthedProviders: vi.fn().mockResolvedValue([]),
  },
}));
vi.mock('../usage_budget_service', () => ({
  getUsageBudget: vi.fn().mockResolvedValue({ providers: [], fetchedAt: '2026-09-29T00:00:00Z' }),
}));

import { setDb } from '../../database/db';
import agentDecisionsRouter from '../../routes/agent_decisions_routes';
import { DecisionConfigError, mergeConfig } from './decision_config_service';
import {
  defaultDecisionSettings,
  loadDecisionSettings,
  normaliseDecisionSettings,
  resetDecisionSettingsCacheForTests,
} from './decision_settings';
import { resetModelCatalogCache } from './model_catalog';

const CAPS = { input: { text: true }, output: { text: true }, toolcall: true };
const m = (id: string, out: number, date: string, family: string) => ({
  id, name: `Name ${id}`, status: 'active', capabilities: CAPS, contextLimit: 200_000,
  cost: { input: out / 5, output: out }, releaseDate: date, family, reasoning: true,
});
const SNAPSHOT = {
  defaults: {},
  providers: [
    { id: 'openai', connected: true, digest: 'o', models: [m('gpt-5.6-luna', 4, '2026-03-01', 'gpt-mini'), m('gpt-5.6-terra', 15, '2026-04-01', 'gpt')] },
    {
      id: 'anthropic', connected: true, digest: 'a',
      models: [m('claude-haiku-5-0', 5, '2025-10-15', 'claude-haiku'), m('claude-opus-4-7', 25, '2026-04-16', 'claude-opus')],
    },
  ],
};

let dir: string;
let db: Database.Database;
let previousDb: Database.Database | null;
const setVisible = (provider: string, modelId: string, visible: boolean) =>
  db.prepare('INSERT OR REPLACE INTO agent_model_visibility (provider, model_id, visible) VALUES (?, ?, ?)')
    .run(provider, modelId, visible ? 1 : 0);
beforeEach(() => {
  db = new Database(':memory:');
  db.exec('CREATE TABLE agent_model_visibility (provider TEXT NOT NULL, model_id TEXT NOT NULL, visible INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (provider, model_id))');
  // Rhythm's Models curation: these four are enabled, so the router may choose among them.
  for (const p of SNAPSHOT.providers) for (const mod of p.models) setVisible(p.id, mod.id, true);
  previousDb = setDb(db);
  dir = mkdtempSync(join(tmpdir(), 'catalog-config-'));
  process.env.RHYTHM_DECISION_ROUTER_FILE = join(dir, 'decision-router.json');
  resetDecisionSettingsCacheForTests();
  resetModelCatalogCache();
  providerSnapshot.mockReset().mockResolvedValue(SNAPSHOT);
});
afterEach(() => {
  setDb(previousDb);
  db.close();
  delete process.env.RHYTHM_DECISION_ROUTER_FILE;
  resetDecisionSettingsCacheForTests();
  rmSync(dir, { recursive: true, force: true });
});

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof DecisionConfigError) return e.code;
    throw e;
  }
  return 'ok';
}

describe('mergeConfig validation', () => {
  const base = defaultDecisionSettings();
  it('defaults: auto mode, seed cutoffs, no overrides or exclusions', () => {
    expect(base.tiers).toEqual({ mode: 'auto', cheapMaxOutputUsd: 6, frontierMinOutputUsd: 25 });
    expect(base.tierOverrides).toEqual({});
    expect(base.excludedModels).toEqual([]);
  });
  it('tiers: auto / manual, cheap < frontier, both > 0', () => {
    expect(mergeConfig(base, { tiers: { mode: 'manual', cheapMaxOutputUsd: 3, frontierMinOutputUsd: 40 } }).tiers)
      .toEqual({ mode: 'manual', cheapMaxOutputUsd: 3, frontierMinOutputUsd: 40 });
    const manual = mergeConfig(base, { tiers: { mode: 'manual', cheapMaxOutputUsd: 3, frontierMinOutputUsd: 40 } });
    // switching back to auto keeps the manual values as the fallback
    expect(mergeConfig(manual, { tiers: { mode: 'auto' } }).tiers)
      .toEqual({ mode: 'auto', cheapMaxOutputUsd: 3, frontierMinOutputUsd: 40 });
    expect(mergeConfig(base, { tiers: { cheapMaxOutputUsd: 2 } }).tiers.mode).toBe('manual');
    for (const tiers of [
      { mode: 'manual', cheapMaxOutputUsd: 25, frontierMinOutputUsd: 25 },
      { mode: 'manual', cheapMaxOutputUsd: 30, frontierMinOutputUsd: 25 },
      { mode: 'manual', cheapMaxOutputUsd: 0, frontierMinOutputUsd: 25 },
      { mode: 'manual', cheapMaxOutputUsd: -1, frontierMinOutputUsd: 25 },
      { mode: 'manual', cheapMaxOutputUsd: 'x', frontierMinOutputUsd: 25 },
      { cheapMaxOutputUsd: 30 }, // 30 >= stored frontier 25
      { mode: 'sometimes' },
      'nope',
    ]) expect(code(() => mergeConfig(base, { tiers }))).toBe('invalid_threshold');
  });
  it('tierOverrides: provider/model -> tier', () => {
    expect(mergeConfig(base, { tierOverrides: { 'openai/gpt-5.6-luna': 'frontier' } }).tierOverrides)
      .toEqual({ 'openai/gpt-5.6-luna': 'frontier' });
    expect(code(() => mergeConfig(base, { tierOverrides: { 'openai/gpt-5.6-luna': 'huge' } }))).toBe('invalid_tier');
    expect(code(() => mergeConfig(base, { tierOverrides: { 'openai/gpt-5.6-luna': 3 } }))).toBe('invalid_tier');
    expect(code(() => mergeConfig(base, { tierOverrides: { 'no-slash': 'cheap' } }))).toBe('invalid_body');
    expect(code(() => mergeConfig(base, { tierOverrides: [] }))).toBe('invalid_body');
  });
  it('excludedModels: unique provider/model strings', () => {
    expect(mergeConfig(base, { excludedModels: ['a/b', 'a/b', 'c/d'] }).excludedModels).toEqual(['a/b', 'c/d']);
    expect(code(() => mergeConfig(base, { excludedModels: 'a/b' }))).toBe('invalid_body');
    expect(code(() => mergeConfig(base, { excludedModels: ['ab'] }))).toBe('invalid_body');
    expect(code(() => mergeConfig(base, { excludedModels: [1] }))).toBe('invalid_body');
  });
  it('normalise tolerates garbage', () => {
    const s = normaliseDecisionSettings({
      tiers: { mode: 'x', cheapMaxOutputUsd: 9, frontierMinOutputUsd: 2 },
      tierOverrides: { 'a/b': 'nope', c: 'cheap', 'd/e': 'standard' },
      excludedModels: ['x/y', 5, 'nosl'],
    });
    expect(s.tiers).toEqual({ mode: 'auto', cheapMaxOutputUsd: 6, frontierMinOutputUsd: 25 });
    expect(s.tierOverrides).toEqual({ 'd/e': 'standard' });
    expect(s.excludedModels).toEqual(['x/y']);
  });
});

describe('GET/PUT /agent-decisions/config catalog', () => {
  let http: Server;
  let base: string;
  beforeEach(async () => {
    const app = express();
    app.use('/agent-decisions', agentDecisionsRouter);
    http = createServer(app);
    await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(http.address() as AddressInfo).port}/agent-decisions`;
  });
  afterEach(() => new Promise<void>((r) => http.close(() => r())));
  const put = (body: unknown) => fetch(`${base}/config`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });

  it('GET returns the contract shape, sorted by tier then provider then newest', async () => {
    const got = (await (await fetch(`${base}/config`)).json()) as any;
    // auto: derived from the 4 priced models (4, 5, 15, 25) -> gaps 5..15 and 15..25
    expect(got.tiers).toEqual({ mode: 'auto', cheapMaxOutputUsd: 8.66, frontierMinOutputUsd: 19.36, derivedFromModels: 4 });
    expect(got.catalog.tiers).toEqual(got.tiers);
    expect(got.catalog.source).toBe('live');
    expect(typeof got.catalog.fetchedAt).toBe('string');
    expect(got.tierOverrides).toEqual({});
    expect(got.excludedModels).toEqual([]);
    expect(got.catalog.models.map((x: any) => `${x.tier}:${x.providerID}/${x.modelID}`)).toEqual([
      'cheap:anthropic/claude-haiku-5-0',
      'cheap:openai/gpt-5.6-luna',
      'standard:openai/gpt-5.6-terra',
      'frontier:anthropic/claude-opus-4-7',
    ]);
    expect(got.catalog.models[0]).toEqual({
      providerID: 'anthropic', modelID: 'claude-haiku-5-0', name: 'Name claude-haiku-5-0', family: 'claude-haiku',
      tier: 'cheap', tierSource: 'cost', costOutputUsd: 5, costInputUsd: 1, releaseDate: '2025-10-15',
      contextLimit: 200000, excluded: false, enabled: true,
    });
    expect(got.catalog.curatedCount).toBe(4);
  });

  it('flags models not enabled in Rhythm curation and derives cutoffs from the curated set only', async () => {
    setVisible('openai', 'gpt-5.6-terra', false); // explicit hide
    db.prepare('DELETE FROM agent_model_visibility WHERE model_id = ?').run('claude-opus-4-7'); // never curated
    const got = (await (await fetch(`${base}/config`)).json()) as any;
    const find = (id: string) => got.catalog.models.find((x: any) => x.modelID === id);
    expect(find('gpt-5.6-terra')).toMatchObject({ enabled: false });
    expect(find('claude-opus-4-7')).toMatchObject({ enabled: false });
    expect(find('claude-haiku-5-0')).toMatchObject({ enabled: true });
    expect(got.catalog.curatedCount).toBe(2);
    expect(got.tiers.derivedFromModels).toBe(0); // 2 curated prices < 3: seed cutoffs
  });

  it('PUT persists tiers / overrides / exclusions and the catalog reflects them immediately', async () => {
    const res = await put({
      tiers: { mode: 'manual', cheapMaxOutputUsd: 4, frontierMinOutputUsd: 20 },
      tierOverrides: { 'openai/gpt-5.6-terra': 'frontier' },
      excludedModels: ['anthropic/claude-haiku-5-0'],
    });
    expect(res.status).toBe(200);
    const view = (await res.json()) as any;
    expect(view.tiers).toEqual({ mode: 'manual', cheapMaxOutputUsd: 4, frontierMinOutputUsd: 20, derivedFromModels: 0 });
    const find = (id: string) => view.catalog.models.find((x: any) => x.modelID === id);
    expect(find('gpt-5.6-terra')).toMatchObject({ tier: 'frontier', tierSource: 'override' });
    expect(find('claude-haiku-5-0')).toMatchObject({ excluded: true, tier: 'standard' }); // 5 > cheap cutoff 4
    expect(find('gpt-5.6-luna')).toMatchObject({ tier: 'cheap' }); // 4 <= 4
    expect(loadDecisionSettings()).toMatchObject({
      tiers: { mode: 'manual', cheapMaxOutputUsd: 4, frontierMinOutputUsd: 20 },
      tierOverrides: { 'openai/gpt-5.6-terra': 'frontier' },
      excludedModels: ['anthropic/claude-haiku-5-0'],
    });
    const again = (await (await fetch(`${base}/config`)).json()) as any;
    expect(again.excludedModels).toEqual(['anthropic/claude-haiku-5-0']);
  });

  it('PUT validation errors are 400 with the contract codes and change nothing', async () => {
    const tier = await put({ tierOverrides: { 'openai/gpt-5.6-luna': 'ultra' } });
    expect(tier.status).toBe(400);
    expect(await tier.json()).toMatchObject({ error: 'invalid_tier' });
    const threshold = await put({ tiers: { mode: 'manual', cheapMaxOutputUsd: 30, frontierMinOutputUsd: 10 } });
    expect(threshold.status).toBe(400);
    expect(await threshold.json()).toMatchObject({ error: 'invalid_threshold' });
    expect(loadDecisionSettings().tierOverrides).toEqual({});
  });

  it('engine unreachable: GET still works with the static catalog', async () => {
    providerSnapshot.mockRejectedValue(new Error('engine_unverified'));
    resetModelCatalogCache();
    const res = await fetch(`${base}/config`);
    expect(res.status).toBe(200);
    const got = (await res.json()) as any;
    expect(got.catalog.source).toBe('static');
    expect(Array.isArray(got.catalog.models)).toBe(true);
  });
});
