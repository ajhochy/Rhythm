import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpencodeClient } from '@opencode-ai/sdk';

const providerSnapshot = vi.fn();
const listAuthedProviders = vi.fn();
vi.mock('../opencode_engine', () => ({
  opencodeClient: {
    providerSnapshot: (...a: unknown[]) => providerSnapshot(...a),
    listAuthedProviders: (...a: unknown[]) => listAuthedProviders(...a),
  },
}));

import { OpencodeClientService, type ProviderSnapshot } from '../opencode_client_service';
import { ROUTE_FALLBACKS_BY_AGENT } from '../agent_model_resolver';
import { defaultDecisionSettings, type DecisionSettings } from './decision_settings';
import {
  deriveTierCutoffs,
  getCatalogForSettings,
  getRoutableModels as getRoutableModelsRaw,
  routeModelForTier,
  pickModelForTier,
  resetModelCatalogCache,
  type RoutableModel,
} from './model_catalog';

const CAPS = { input: { text: true }, output: { text: true }, toolcall: true };
interface M { out?: number; inp?: number; date?: string; family?: string; status?: string; caps?: typeof CAPS | undefined }
const model = (id: string, o: M = {}) => ({
  id,
  name: id,
  status: o.status ?? 'active',
  contextLimit: 200_000,
  capabilities: CAPS,
  ...(o.out !== undefined ? { cost: { input: o.inp ?? o.out / 5, output: o.out } } : {}),
  ...(o.date ? { releaseDate: o.date } : {}),
  ...(o.family ? { family: o.family } : {}),
  reasoning: true,
});
const provider = (id: string, models: ReturnType<typeof model>[], connected = true) =>
  ({ id, connected, digest: `d-${id}`, models });
const snap = (...providers: ReturnType<typeof provider>[]): ProviderSnapshot => ({ providers, defaults: {} });
const settings = (over: Partial<DecisionSettings> = {}): DecisionSettings => ({
  ...defaultDecisionSettings(),
  tiers: { mode: 'manual', cheapMaxOutputUsd: 6, frontierMinOutputUsd: 25 },
  ...over,
});
/** Every model in the snapshot is enabled in Rhythm's Models curation (visible=1). */
const enableAll = (s: ProviderSnapshot): Map<string, boolean> =>
  new Map(s.providers.flatMap((p) => p.models.map((m) => [`${p.id}\0${m.id}`, true] as [string, boolean])));
const curated = (...keys: string[]): Map<string, boolean> => new Map(keys.map((k) => [k.replace('/', '\0'), true]));
const getRoutableModels = (o: Parameters<typeof getRoutableModelsRaw>[0] = {}) =>
  getRoutableModelsRaw({ ...(o.snapshot && !o.visibility ? { visibility: enableAll(o.snapshot) } : {}), ...o });
const ids = (models: RoutableModel[]) => models.map((m) => `${m.providerID}/${m.modelID}`);
const byId = (models: RoutableModel[], id: string) => models.find((m) => m.modelID === id)!;

beforeEach(() => {
  providerSnapshot.mockReset();
  listAuthedProviders.mockReset().mockResolvedValue([]);
  resetModelCatalogCache();
});

describe('providerSnapshot pass-through', () => {
  it('keeps cost, releaseDate, family and reasoning next to the existing fields', async () => {
    const service = new OpencodeClientService();
    service.__setTestAuthedProviders([]);
    const providers = vi.fn().mockResolvedValue({ data: { providers: [{
      id: 'sample',
      models: {
        priced: {
          id: 'priced', name: 'Priced', family: 'fam', release_date: '2026-04-16', reasoning: true,
          cost: { input: 5, output: 25, cache_read: 0.5, cache_write: 6.25 },
          capabilities: CAPS, status: 'active', limit: { context: 1000 },
        },
        nested: { id: 'nested', cost: { input: 1, output: 2, cache: { read: 0.1, write: 0.2 } }, capabilities: CAPS },
        bare: { id: 'bare', capabilities: CAPS },
      },
    }] } });
    service.__setTestClient({ config: { providers } } as unknown as OpencodeClient);
    const { providers: out } = await service.providerSnapshot();
    const [priced, nested, bare] = out[0].models;
    expect(priced).toEqual({
      id: 'priced', name: 'Priced', status: 'active', contextLimit: 1000,
      cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
      releaseDate: '2026-04-16', family: 'fam', reasoning: true,
      capabilities: { input: { text: true }, output: { text: true }, toolcall: true },
    });
    expect(nested.cost).toEqual({ input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0.2 });
    expect(bare).not.toHaveProperty('cost');
    expect(bare).not.toHaveProperty('releaseDate');
    expect(out[0].digest).toEqual(expect.any(String));
  });
});

describe('getRoutableModels tiering (manual cutoffs 6 / 25)', () => {
  it('bands by output price, override wins, missing cost uses the name heuristic, keyless is cheap', async () => {
    const r = await getRoutableModels({
      snapshot: snap(
        provider('anthropic', [
          model('claude-haiku-4-5', { out: 5, date: '2025-10-15' }),
          model('claude-sonnet-4-6', { out: 15, date: '2026-02-17' }),
          model('claude-opus-4-7', { out: 25, date: '2026-04-16' }),
        ]),
        provider('acme', [
          model('acme-x', { out: 6 }), // boundary: <= 6 is cheap
          model('acme-opus-lookalike'), // no cost -> heuristic ('opus' -> frontier)
          model('acme-y', { out: 10 }),
        ]),
        provider('ollama', [model('qwen3.6-work'), model('llama-huge', { out: 500 })]),
      ),
      settings: settings({ tierOverrides: { 'acme/acme-y': 'frontier' } }),
    });
    expect(r.source).toBe('live');
    const tier = (id: string) => byId(r.models, id).tier;
    expect(tier('claude-haiku-4-5')).toBe('cheap');
    expect(tier('claude-sonnet-4-6')).toBe('standard');
    expect(tier('claude-opus-4-7')).toBe('frontier');
    expect(tier('acme-x')).toBe('cheap');
    expect(byId(r.models, 'acme-opus-lookalike')).toMatchObject({ tier: 'frontier', tierSource: 'heuristic', costOutputUsd: null });
    expect(byId(r.models, 'acme-y')).toMatchObject({ tier: 'frontier', tierSource: 'override' });
    expect(byId(r.models, 'claude-haiku-4-5')).toMatchObject({ tierSource: 'cost', costOutputUsd: 5, costInputUsd: 1, releaseDate: '2025-10-15' });
    // keyless local: zero cost, cheap, whatever the catalog says
    expect(byId(r.models, 'qwen3.6-work')).toMatchObject({ tier: 'cheap', keyless: true, costOutputUsd: 0 });
    expect(byId(r.models, 'llama-huge')).toMatchObject({ tier: 'cheap', costOutputUsd: 0 });
  });

  it('drops ineligible, unconnected, excluded and unentitled models', async () => {
    const r = await getRoutableModels({
      snapshot: snap(
        provider('acme', [
          model('gpt-a', { out: 4 }),
          model('gpt-b', { out: 4 }),
          model('gpt-old', { out: 4, status: 'deprecated' }),
          { ...model('gpt-notools', { out: 4 }), capabilities: { input: { text: true }, output: { text: true }, toolcall: false } },
        ]),
        provider('google', [model('gemini-a', { out: 2 })], false),
        provider('anthropic', [model('claude-haiku-4-5', { out: 5 })]),
      ),
      entitled: { acme: { 'gpt-b': false, 'gpt-a': true } },
      settings: settings({ excludedModels: ['anthropic/claude-haiku-4-5'] }),
    });
    expect(ids(r.models)).toEqual(['acme/gpt-a']);
  });

  it('orders newest release first within provider and tier; unknown dates last', async () => {
    const r = await getRoutableModels({
      snapshot: snap(provider('acme', [
        model('m-old', { out: 2, date: '2025-01-01' }),
        model('m-undated', { out: 2 }),
        model('m-new', { out: 2, date: '2026-03-01' }),
        model('m-mid', { out: 2, date: '2025-09-01' }),
      ])),
      settings: settings(),
    });
    expect(r.models.map((m) => m.modelID)).toEqual(['m-new', 'm-mid', 'm-old', 'm-undated']);
  });

  it('hides -1m / :extended variants unless the base route is one', async () => {
    const snapshot = snap(provider('anthropic', [
      model('claude-opus-4-7', { out: 25, date: '2026-04-16' }),
      model('claude-opus-4-7-1m', { out: 25, date: '2026-04-16' }),
    ]));
    const plain = await getRoutableModels({ snapshot, settings: settings() });
    expect(plain.models.map((m) => m.modelID)).toEqual(['claude-opus-4-7']);
    const long = await getRoutableModels({
      snapshot, settings: settings(),
      baseRoute: { providerID: 'anthropic', modelID: 'claude-opus-4-7-1m' },
    });
    expect(long.models.map((m) => m.modelID).sort()).toEqual(['claude-opus-4-7', 'claude-opus-4-7-1m']);
  });
});

/** Real models.dev prices (USD / 1M output tokens) and families. */
const REAL = {
  anthropic: [
    ['claude-haiku-4-5', 5, 'claude-haiku', '2025-10-15'],
    ['claude-sonnet-4-6', 15, 'claude-sonnet', '2026-02-17'],
    ['claude-opus-4-7', 25, 'claude-opus', '2026-04-16'],
  ],
  openai: [
    ['gpt-5.4-nano', 1.25, 'gpt-nano', '2026-03-17'],
    ['gpt-5.4-mini', 4.5, 'gpt-mini', '2026-03-17'],
    ['gpt-5.3-codex', 14, 'gpt-codex', '2026-02-05'],
    ['gpt-5.4', 15, 'gpt', '2026-03-05'],
    ['gpt-5.5', 30, 'gpt', '2026-04-23'],
    ['gpt-5.5-pro', 180, 'gpt-pro', '2026-04-23'],
  ],
  google: [
    ['gemini-3.1-flash-lite', 1.5, 'gemini-flash-lite', '2026-05-07'],
    ['gemini-3-flash-preview', 3, 'gemini-flash', '2025-12-17'],
    ['gemini-3.1-pro-preview', 12, 'gemini-pro', '2026-02-19'],
  ],
} as const;

function realSnapshot(rows: Record<string, ReadonlyArray<readonly [string, number, string, string]>>): ProviderSnapshot {
  return snap(...Object.entries(rows).map(([id, list]) =>
    provider(id, list.map(([mid, out, family, date]) => model(mid, { out, family, date })))));
}

describe('Rhythm curation is the only visibility gate', () => {
  const snapshot = () => snap(
    provider('openai', [model('gpt-5.6-terra', { out: 15 }), model('gpt-5.5', { out: 30 })]),
    provider('anthropic', [model('claude-sonnet-5-5', { out: 15 }), model('claude-opus-5-5', { out: 25 })]),
  );

  it('routes only explicit visible=1 models: outside-any-list is routable, policy-listed without a row is not', async () => {
    // gpt-5.5 is outside the static openai allowlist; gpt-5.6-terra is on it but has no row.
    const r = await getRoutableModelsRaw({
      snapshot: snapshot(), settings: settings(), visibility: curated('openai/gpt-5.5', 'anthropic/claude-sonnet-5-5'),
    });
    expect(ids(r.models).sort()).toEqual(['anthropic/claude-sonnet-5-5', 'openai/gpt-5.5']);
  });

  it('visible=0 is not routable even for a policy-listed model, and is flagged in the settings view', async () => {
    const visibility = new Map([['openai\0gpt-5.6-terra', false], ['anthropic\0claude-sonnet-5-5', true]]);
    const opts = { snapshot: snapshot(), settings: settings(), visibility };
    expect(ids((await getRoutableModelsRaw(opts)).models)).toEqual(['anthropic/claude-sonnet-5-5']);
    const view = await getCatalogForSettings(opts);
    expect(view.curatedCount).toBe(1);
    const flag = (id: string) => view.models.find((m) => m.modelID === id)?.enabled;
    expect(flag('gpt-5.6-terra')).toBe(false);
    expect(flag('claude-opus-5-5')).toBe(false); // no row: not enabled either
    expect(flag('claude-sonnet-5-5')).toBe(true);
  });

  it('empty curation: live source, no models, reason no_curated_models', async () => {
    const r = await getRoutableModelsRaw({ snapshot: snapshot(), settings: settings(), visibility: new Map() });
    expect(r).toMatchObject({ source: 'live', models: [], curatedCount: 0, reason: 'no_curated_models' });
  });

  it('empty curation keeps the baseline route (no static-table fallback) and reports the reason', async () => {
    providerSnapshot.mockResolvedValue(snapshot());
    const base = { providerID: 'anthropic', modelID: 'claude-haiku-4-5' };
    const r = await routeModelForTier({ tier: 'frontier', agentId: 'claude-code', baseRoute: base });
    expect(r.route).toEqual(base);
    expect(r.catalog).toBe('live');
    expect(r.reason).toBe('no_curated_models');
  });

  it('sonnet enabled / opus disabled: a frontier request never picks opus', async () => {
    const snapshotOpus = snap(provider('anthropic', [
      model('claude-haiku-5-0', { out: 5 }),
      model('claude-sonnet-5-5', { out: 15 }),
      model('claude-opus-5-5', { out: 25 }),
    ]));
    const cat = await getRoutableModelsRaw({
      snapshot: snapshotOpus, settings: settings(),
      visibility: new Map([['anthropic\0claude-sonnet-5-5', true], ['anthropic\0claude-opus-5-5', false]]),
    });
    expect(ids(cat.models)).toEqual(['anthropic/claude-sonnet-5-5']);
    // No enabled frontier model: pickModelForTier has nothing at that tier, so callers fall to the base route.
    expect(pickModelForTier({ tier: 'frontier', models: cat.models })).toBeUndefined();
    expect(pickModelForTier({ tier: 'standard', models: cat.models })?.modelID).toBe('claude-sonnet-5-5');
  });

  it('derived cutoffs use only the curated set', async () => {
    const r = await getRoutableModelsRaw({
      snapshot: snap(provider('acme', [
        model('a', { out: 1, family: 'a' }), model('b', { out: 2, family: 'b' }),
        model('c', { out: 30, family: 'c' }), model('d', { out: 300, family: 'd' }),
      ])),
      settings: settings({ tiers: { mode: 'auto', cheapMaxOutputUsd: 6, frontierMinOutputUsd: 25 } }),
      visibility: curated('acme/a'),
    });
    expect(r.tiers.derivedFromModels).toBe(0); // one curated priced model: seed values kept
    expect(r.tiers.cheapMaxOutputUsd).toBe(6);
  });
});

describe('auto tier cutoffs derived from the catalog', () => {
  const ALL = new Set(['haiku', 'nano', 'mini', 'flash-lite', 'flash', 'sonnet', 'codex', 'gemini-3.1-pro', 'opus', 'gpt-5.5', 'gpt-5.5-pro']);
  const tiersOf = (models: RoutableModel[], tier: string) =>
    new Set(models.filter((m) => m.tier === tier).map((m) => m.modelID));

  function expectRealBands(r: Awaited<ReturnType<typeof getRoutableModels>>) {
    expect(ALL.size).toBe(11);
    expect(r.tiers.mode).toBe('auto');
    expect(r.tiers.cheapMaxOutputUsd).toBeGreaterThan(5);
    expect(r.tiers.cheapMaxOutputUsd).toBeLessThan(10);
    expect(r.tiers.frontierMinOutputUsd).toBeGreaterThan(15);
    expect(r.tiers.frontierMinOutputUsd).toBeLessThan(25);
    expect(r.tiers.derivedFromModels).toBeGreaterThanOrEqual(3);
    expect(tiersOf(r.models, 'cheap')).toEqual(new Set([
      'claude-haiku-4-5', 'gpt-5.4-nano', 'gpt-5.4-mini', 'gemini-3.1-flash-lite', 'gemini-3-flash-preview',
    ]));
    expect(tiersOf(r.models, 'standard')).toEqual(new Set([
      'claude-sonnet-4-6', 'gpt-5.4', 'gpt-5.3-codex', 'gemini-3.1-pro-preview',
    ]));
    expect(tiersOf(r.models, 'frontier')).toEqual(new Set(['claude-opus-4-7', 'gpt-5.5', 'gpt-5.5-pro']));
    expect(r.models.every((m) => m.tierSource === 'cost')).toBe(true);
    // 5 -> 12 and 15 -> 25 are the natural gaps; the $180 outlier must not drag a cutoff to ~70.
    const openai = r.models.filter((m) => m.providerID === 'openai');
    const pick = pickModelForTier({
      tier: 'frontier',
      baseRoute: { providerID: 'openai', modelID: 'gpt-5.4' },
      models: openai,
      ultraMinOutputUsd: r.tiers.frontierMinOutputUsd * 5,
    });
    expect(pick?.modelID).toBe('gpt-5.5');
  }

  it('real prices: cutoffs land in the natural gaps and tiers come out as expected', async () => {
    expectRealBands(await getRoutableModels({
      snapshot: realSnapshot({ anthropic: REAL.anthropic, openai: REAL.openai, google: REAL.google }),
      settings: settings({ tiers: { mode: 'auto', cheapMaxOutputUsd: 6, frontierMinOutputUsd: 25 } }),
    }));
  });

  const fixture = join(__dirname, '../../../../opencode_fork/packages/opencode/test/tool/fixtures/models-api.json');
  it.skipIf(!existsSync(fixture))('same result from the vendored models.dev snapshot', async () => {
    const api = JSON.parse(readFileSync(fixture, 'utf8')) as Record<string, { models: Record<string, {
      cost?: { output?: number }; family?: string; release_date?: string;
    }> }>;
    const pick = (providerID: string, list: ReadonlyArray<readonly [string, ...unknown[]]>) =>
      [providerID, list.map(([id]) => {
        const real = api[providerID].models[id];
        return [id, real.cost!.output!, real.family!, real.release_date!] as const;
      })] as const;
    const rows = Object.fromEntries([
      pick('anthropic', REAL.anthropic), pick('openai', REAL.openai), pick('google', REAL.google),
    ]);
    expectRealBands(await getRoutableModels({
      snapshot: realSnapshot(rows),
      settings: settings({ tiers: { mode: 'auto', cheapMaxOutputUsd: 6, frontierMinOutputUsd: 25 } }),
    }));
  });

  it('manual mode ignores the catalog and uses the stored cutoffs', async () => {
    const r = await getRoutableModels({
      snapshot: realSnapshot({ anthropic: REAL.anthropic, openai: REAL.openai, google: REAL.google }),
      settings: settings({ tiers: { mode: 'manual', cheapMaxOutputUsd: 2, frontierMinOutputUsd: 20 } }),
    });
    expect(r.tiers).toEqual({ mode: 'manual', cheapMaxOutputUsd: 2, frontierMinOutputUsd: 20, derivedFromModels: 0 });
    expect(tiersOf(r.models, 'cheap')).toEqual(new Set(['gpt-5.4-nano', 'gemini-3.1-flash-lite']));
  });

  it('guard rails: <3 distinct prices fall back to the stored values; cutoffs clamp to [1,100]', () => {
    const row = (out: number, family: string) =>
      ({ providerID: 'p', modelID: family, family, releaseDate: null, costOutputUsd: out });
    const fallback = { cheapMaxOutputUsd: 6, frontierMinOutputUsd: 25 };
    expect(deriveTierCutoffs([row(1, 'a'), row(5, 'b')], fallback)).toEqual({ ...fallback, derivedFromModels: 0 });
    expect(deriveTierCutoffs([row(5, 'a'), row(5, 'b'), row(5, 'c')], fallback).derivedFromModels).toBe(0);
    const tiny = deriveTierCutoffs([row(0.01, 'a'), row(0.02, 'b'), row(0.04, 'c')], fallback);
    expect(tiny.cheapMaxOutputUsd).toBeGreaterThanOrEqual(1);
    const huge = deriveTierCutoffs([row(400, 'a'), row(800, 'b'), row(1600, 'c')], fallback);
    expect(huge.frontierMinOutputUsd).toBeLessThanOrEqual(100);
    // A degenerate clamp (both cutoffs pinned to the same value) also falls back.
    expect(deriveTierCutoffs([row(0.01, 'a'), row(0.02, 'b'), row(0.03, 'c')], fallback).derivedFromModels).toBe(0);
  });

  it('uses only the newest model per family', () => {
    const rows = [
      { providerID: 'p', modelID: 'old', family: 'f', releaseDate: '2025-01-01', costOutputUsd: 1 },
      { providerID: 'p', modelID: 'new', family: 'f', releaseDate: '2026-01-01', costOutputUsd: 8 },
      { providerID: 'p', modelID: 'b', family: 'g', releaseDate: null, costOutputUsd: 16 },
      { providerID: 'p', modelID: 'c', family: 'h', releaseDate: null, costOutputUsd: 60 },
    ];
    const r = deriveTierCutoffs(rows, { cheapMaxOutputUsd: 6, frontierMinOutputUsd: 25 });
    expect(r.derivedFromModels).toBe(3);
  });
});

describe('pickModelForTier preference order', () => {
  const rm = (providerID: string, modelID: string, tier: RoutableModel['tier'], out: number | null, date: string | null): RoutableModel => ({
    providerID, modelID, name: modelID, family: null, tier, tierSource: 'cost',
    costInputUsd: null, costOutputUsd: out, releaseDate: date, contextLimit: null, reasoning: null, keyless: false,
  });
  const models = [
    rm('anthropic', 'a-cheap', 'standard', 15, '2026-02-01'),
    rm('openai', 'o-old-cheaper', 'standard', 10, '2025-06-01'),
    rm('openai', 'o-new-pricier', 'standard', 14, '2026-03-01'),
    rm('openai', 'o-new-same', 'standard', 10, '2026-01-01'),
    rm('google', 'g-std', 'standard', 12, '2026-01-01'),
    rm('openrouter', 'or-std', 'standard', 3, '2026-05-01'),
    rm('openai', 'o-front', 'frontier', 30, '2026-04-01'),
    rm('openai', 'o-pro', 'frontier', 180, '2026-04-01'),
    rm('anthropic', 'a-pro', 'frontier', 200, '2026-05-01'),
  ];
  const pick = (over: Partial<Parameters<typeof pickModelForTier>[0]> = {}) =>
    pickModelForTier({ tier: 'standard', models, ...over })?.modelID;

  it('base provider first', () => {
    expect(pick({ baseRoute: { providerID: 'anthropic', modelID: 'x' }, headroomByProvider: { openai: 0.9 } })).toBe('a-cheap');
  });
  it('then most headroom (known before unknown)', () => {
    expect(pick({ baseRoute: { providerID: 'nobody', modelID: 'x' }, headroomByProvider: { google: 0.8, openai: 0.3 } })).toBe('g-std');
    expect(pick({ headroomByProvider: { openai: 0.3 } })).toBe('o-new-same');
  });
  it('then any provider (direct before aggregator, then id)', () => {
    expect(pick()).toBe('a-cheap');
  });
  it('within the provider: lowest output cost, then newest release', () => {
    expect(pick({ baseRoute: { providerID: 'openai', modelID: 'x' } })).toBe('o-new-same');
  });
  it('ultra-priced models stay eligible but sort last, across providers too', () => {
    expect(pick({ tier: 'frontier', baseRoute: { providerID: 'openai', modelID: 'x' }, ultraMinOutputUsd: 100 })).toBe('o-front');
    expect(pick({ tier: 'frontier', baseRoute: { providerID: 'anthropic', modelID: 'x' }, ultraMinOutputUsd: 100 })).toBe('o-front');
    expect(pickModelForTier({ tier: 'frontier', models: [models[8]], ultraMinOutputUsd: 100 })?.modelID).toBe('a-pro');
  });
  it('returns undefined when the tier is empty', () => {
    expect(pickModelForTier({ tier: 'cheap', models })).toBeUndefined();
  });
});

describe('static fallback', () => {
  it.each([
    ['empty snapshot', snap()],
    ['unreachable engine', undefined],
  ])('builds from ROUTE_FALLBACKS_BY_AGENT for authed providers only (%s)', async (_label, snapshot) => {
    providerSnapshot.mockRejectedValue(new Error('engine_unverified'));
    const r = await getRoutableModels({
      ...(snapshot ? { snapshot } : {}),
      authed: ['anthropic', 'openai'],
      settings: settings(),
    });
    expect(r.source).toBe('static');
    const providers = new Set(r.models.map((m) => m.providerID));
    expect(providers).toEqual(new Set(['anthropic', 'openai']));
    expect(r.models.every((m) => m.tierSource === 'heuristic')).toBe(true);
    expect(byId(r.models, 'claude-opus-4-7').tier).toBe('frontier');
    expect(byId(r.models, 'claude-haiku-4-5').tier).toBe('cheap');
    expect(r.models.some((m) => m.modelID === 'claude-opus-4-7-1m')).toBe(false);
    const known = new Set(Object.values(ROUTE_FALLBACKS_BY_AGENT).flat().map((x) => x.modelID));
    expect(r.models.every((m) => known.has(m.modelID))).toBe(true);
  });

  it('reads authed providers from the engine when not injected', async () => {
    providerSnapshot.mockRejectedValue(new Error('engine_unverified'));
    listAuthedProviders.mockResolvedValue(['google']);
    const r = await getRoutableModels({ settings: settings() });
    expect(r.source).toBe('static');
    expect(new Set(r.models.map((m) => m.providerID))).toEqual(new Set(['google']));
  });
});

describe('cache', () => {
  it('serves 60s from memory and is invalidated when the settings change', async () => {
    providerSnapshot.mockResolvedValue(snap(provider('acme', [model('m', { out: 10 })])));
    const vis = curated('acme/m');
    const a = await getRoutableModelsRaw({ settings: settings(), visibility: vis });
    await getRoutableModelsRaw({ settings: settings(), visibility: vis });
    expect(providerSnapshot).toHaveBeenCalledTimes(1);
    expect(byId(a.models, 'm').tier).toBe('standard');
    const b = await getRoutableModelsRaw({ settings: settings({ tierOverrides: { 'acme/m': 'cheap' } }), visibility: vis });
    expect(providerSnapshot).toHaveBeenCalledTimes(2);
    expect(byId(b.models, 'm').tier).toBe('cheap');
    resetModelCatalogCache();
    await getRoutableModelsRaw({ settings: settings({ tierOverrides: { 'acme/m': 'cheap' } }), visibility: vis });
    expect(providerSnapshot).toHaveBeenCalledTimes(3);
  });

  it('is invalidated when the Rhythm visibility curation changes', async () => {
    providerSnapshot.mockResolvedValue(snap(provider('acme', [model('m', { out: 10 })])));
    const on = await getRoutableModelsRaw({ settings: settings(), visibility: curated('acme/m') });
    expect(ids(on.models)).toEqual(['acme/m']);
    await getRoutableModelsRaw({ settings: settings(), visibility: curated('acme/m') });
    expect(providerSnapshot).toHaveBeenCalledTimes(1);
    const off = await getRoutableModelsRaw({ settings: settings(), visibility: new Map([['acme\0m', false]]) });
    expect(providerSnapshot).toHaveBeenCalledTimes(2);
    expect(off.models).toEqual([]);
  });
});
