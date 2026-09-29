import { KEYLESS_PROVIDER_IDS } from '../opencode_client_service';
import type { ProviderSnapshot } from '../opencode_client_service';
import {
  ROUTE_FALLBACKS_BY_AGENT,
  classifyRouteTier,
  type ModelRoute,
  type ModelTier,
} from '../agent_model_resolver';
import { eligibleModel } from '../provider_catalog_policy';
import { loadModelVisibility, visibilityKey } from '../model_visibility';
import { getUsageBudget } from '../usage_budget_service';
import {
  loadDecisionSettings,
  type DecisionSettings,
} from './decision_settings';

/**
 * The live model catalog the router and the capacity layer choose among.
 *
 * Source of truth is the engine catalog (`opencodeClient.providerSnapshot()`):
 * connected providers, restricted to the models enabled in Rhythm's Models curation
 * (`agent_model_visibility`, explicit visible=1; the static approved-family policy is not
 * consulted), filtered by eligibility and account entitlements, tiered by OUTPUT PRICE (not by model-name substrings), with
 * per-model overrides and exclusions from Router settings. The hardcoded
 * ROUTE_FALLBACKS_BY_AGENT table is used only when the engine catalog is empty
 * or unreachable (`source: 'static'`).
 */

export type TierSource = 'cost' | 'heuristic' | 'override';

export interface RoutableModel {
  providerID: string;
  modelID: string;
  name: string;
  family: string | null;
  tier: ModelTier;
  tierSource: TierSource;
  /** USD per 1M tokens; null when the catalog carries no price. Keyless local = 0. */
  costInputUsd: number | null;
  costOutputUsd: number | null;
  releaseDate: string | null;
  contextLimit: number | null;
  reasoning: boolean | null;
  keyless: boolean;
}

export type CatalogSource = 'live' | 'static';

/** Cutoffs actually in force (derived from the catalog in auto mode). */
export interface EffectiveTiers {
  mode: 'auto' | 'manual';
  cheapMaxOutputUsd: number;
  frontierMinOutputUsd: number;
  /** Newest-per-family priced models that fed the derivation (0 in manual mode / on fallback). */
  derivedFromModels: number;
}

export interface RoutableCatalog {
  models: RoutableModel[];
  source: CatalogSource;
  fetchedAt: string;
  tiers: EffectiveTiers;
  /** Live catalog only: number of models enabled in Rhythm's Models curation. */
  curatedCount: number;
  /** Set when nothing is curated: the router keeps the baseline route (no static fallback). */
  reason?: 'no_curated_models';
}

/** Models priced at or above this multiple of the frontier cutoff stay frontier but sort last. */
export const ULTRA_PRICE_MULTIPLE = 5;
const MIN_CUTOFF_USD = 1;
const MAX_CUTOFF_USD = 100;
const MIN_DISTINCT_PRICES = 3;

/** provider/model -> entitled?, per route provider id. */
export type EntitledModels = Record<string, Record<string, boolean>>;

export interface RoutableModelOptions {
  /** Long-context variants (-1m, :extended) are included only when this route is one. */
  baseRoute?: ModelRoute;
  /** In the static fallback this agent's routes are ordered first. */
  agentId?: string;
  snapshot?: ProviderSnapshot;
  /** Connected provider ids (overrides the snapshot's own connected flags). */
  authed?: Iterable<string>;
  entitled?: EntitledModels;
  settings?: DecisionSettings;
  /** Rhythm's curated visibility (`provider\0model` -> visible); defaults to the agent_model_visibility table. */
  visibility?: ReadonlyMap<string, boolean>;
}

interface InternalModel extends RoutableModel {
  excluded: boolean;
  /** Enabled in Rhythm's Models curation (same rule as the model picker). */
  enabled: boolean;
  longContext: boolean;
  order: number;
}

interface BaseCatalog {
  models: InternalModel[];
  source: CatalogSource;
  fetchedAt: string;
  tiers: EffectiveTiers;
  curatedCount: number;
}

const TIER_RANK: Record<ModelTier, number> = { cheap: 0, standard: 1, frontier: 2 };
const AGGREGATOR_IDS = new Set(['openrouter', 'together', 'groq']);
const CACHE_TTL_MS = 60_000;
const LONG_CONTEXT_RE = /(?:-1m(?:$|-)|:extended|long-?context)/i;

const USAGE_TO_ROUTE_PROVIDER: Record<string, string> = {
  anthropic: 'anthropic',
  openai: 'openai',
  gemini: 'google',
};

export const modelKey = (providerID: string, modelID: string): string => `${providerID}/${modelID}`;

export function isLongContextModelId(modelID: string): boolean {
  return LONG_CONTEXT_RE.test(modelID);
}

let cache: { key: string; at: number; value: BaseCatalog } | null = null;

export function resetModelCatalogCache(): void {
  cache = null;
}

function settingsKey(settings: DecisionSettings, visibility: ReadonlyMap<string, boolean>): string {
  return JSON.stringify([
    settings.tiers,
    settings.tierOverrides,
    [...settings.excludedModels].sort(),
    // Digest of the curation rows: a visibility change misses the cache without any explicit invalidation.
    [...visibility].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  ]);
}

const median = (sorted: number[]): number => {
  const mid = sorted.length / 2;
  return Number.isInteger(mid) ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[Math.floor(mid)];
};

/**
 * Derive the two output-price cutoffs from the catalog instead of hardcoding them.
 *
 * Newest priced model per (provider, family) -> sorted distinct prices. Ultra-priced
 * outliers (more than 5x the median) are trimmed so one $180 model cannot pull a
 * cutoff away from the real bands. The sorted prices are split at the middle; the
 * largest log-price gap in the lower half becomes the cheap/standard cutoff and the
 * largest gap in the upper half the standard/frontier cutoff (each at the geometric
 * midpoint of its gap), so the two cutoffs can never land in the same gap. Fewer than
 * three distinct prices, or a degenerate result, falls back to `fallback`. Cutoffs are
 * clamped to [$1, $100].
 */
export function deriveTierCutoffs(
  models: ReadonlyArray<{
    providerID: string;
    modelID: string;
    family: string | null;
    releaseDate: string | null;
    costOutputUsd: number | null;
  }>,
  fallback: { cheapMaxOutputUsd: number; frontierMinOutputUsd: number },
): { cheapMaxOutputUsd: number; frontierMinOutputUsd: number; derivedFromModels: number } {
  const newest = new Map<string, { releaseDate: string | null; price: number }>();
  for (const m of models) {
    if (m.costOutputUsd === null || !(m.costOutputUsd > 0)) continue;
    const key = `${m.providerID}\0${m.family ?? m.modelID}`;
    const cur = newest.get(key);
    if (!cur || (m.releaseDate !== null && (cur.releaseDate === null || m.releaseDate > cur.releaseDate))) {
      newest.set(key, { releaseDate: m.releaseDate, price: m.costOutputUsd });
    }
  }
  const all = [...newest.values()].map((v) => v.price).sort((a, b) => a - b);
  const cap = median(all.length > 0 ? all : [0]) * ULTRA_PRICE_MULTIPLE;
  const prices = [...new Set(all.filter((p) => p <= cap))];
  const fallbackResult = { ...fallback, derivedFromModels: 0 };
  if (prices.length < MIN_DISTINCT_PRICES) return fallbackResult;
  const split = Math.floor(prices.length / 2);
  const midpoint = (from: number, to: number): number | null => {
    let best = -1;
    let bestGap = 0;
    for (let i = from; i <= to; i++) {
      const gap = Math.log(prices[i + 1] / prices[i]);
      if (gap > bestGap) {
        bestGap = gap;
        best = i;
      }
    }
    return best < 0 ? null : Math.sqrt(prices[best] * prices[best + 1]);
  };
  const cheap = midpoint(0, split - 1);
  const frontier = midpoint(split, prices.length - 2);
  if (cheap === null || frontier === null) return fallbackResult;
  const clamp = (v: number): number =>
    Math.round(Math.min(MAX_CUTOFF_USD, Math.max(MIN_CUTOFF_USD, v)) * 100) / 100;
  const cheapMaxOutputUsd = clamp(cheap);
  const frontierMinOutputUsd = clamp(frontier);
  if (cheapMaxOutputUsd >= frontierMinOutputUsd) return fallbackResult;
  return { cheapMaxOutputUsd, frontierMinOutputUsd, derivedFromModels: all.length };
}

function tierFor(
  providerID: string,
  modelID: string,
  costOutput: number | null,
  keyless: boolean,
  settings: DecisionSettings,
  cutoffs: { cheapMaxOutputUsd: number; frontierMinOutputUsd: number },
  staticCatalog: boolean,
): { tier: ModelTier; tierSource: TierSource } {
  const override = settings.tierOverrides[modelKey(providerID, modelID)];
  if (override) return { tier: override, tierSource: 'override' };
  if (keyless) return { tier: 'cheap', tierSource: staticCatalog ? 'heuristic' : 'cost' };
  if (!staticCatalog && costOutput !== null) {
    if (costOutput <= cutoffs.cheapMaxOutputUsd) return { tier: 'cheap', tierSource: 'cost' };
    if (costOutput >= cutoffs.frontierMinOutputUsd) return { tier: 'frontier', tierSource: 'cost' };
    return { tier: 'standard', tierSource: 'cost' };
  }
  return { tier: classifyRouteTier({ providerID, modelID }), tierSource: 'heuristic' };
}

/** Per-provider entitlement map from the cached usage snapshot (never a probe). */
async function readEntitlements(): Promise<EntitledModels> {
  const out: EntitledModels = {};
  try {
    const usage = await getUsageBudget({ cachedOnly: true });
    for (const entry of usage?.providers ?? []) {
      const providerID = USAGE_TO_ROUTE_PROVIDER[entry.provider];
      const map = entry.entitledModels;
      if (!providerID || !map || typeof map !== 'object' || Array.isArray(map)) continue;
      const merged = (out[providerID] ??= {});
      // Several accounts per provider: entitled when ANY account is.
      for (const [id, value] of Object.entries(map)) {
        if (typeof value !== 'boolean') continue;
        merged[id] = merged[id] === true || value;
      }
    }
  } catch {
    // Entitlements are advisory; unknown means "not filtered".
  }
  return out;
}

function buildLive(
  snapshot: ProviderSnapshot,
  opts: RoutableModelOptions,
  entitled: EntitledModels,
  settings: DecisionSettings,
  visibility: ReadonlyMap<string, boolean>,
): { models: InternalModel[]; tiers: EffectiveTiers; curatedCount: number } {
  const authed = opts.authed ? new Set(opts.authed) : null;
  const excluded = new Set(settings.excludedModels);
  const out: InternalModel[] = [];
  let order = 0;
  for (const provider of snapshot.providers) {
    const keyless = KEYLESS_PROVIDER_IDS.has(provider.id);
    const connected = authed ? authed.has(provider.id) || keyless : provider.connected;
    if (!connected) continue;
    const eligible = provider.models.filter(eligibleModel);
    const ent = entitled[provider.id];
    for (const model of eligible) {
      // Fail-open: only an explicit `false` (account lacks the model) drops it.
      if (ent && ent[model.id] === false) continue;
      // The routable set is exactly what Rhythm's Models curation enabled (explicit visible=1).
      // No row, or visible=0, means not enabled; the static approved-family policy is not consulted.
      const enabled = visibility.get(visibilityKey(provider.id, model.id)) === true;
      const costOutput = keyless ? 0 : model.cost?.output ?? null;
      const costInput = keyless ? 0 : model.cost?.input ?? null;
      out.push({
        providerID: provider.id,
        modelID: model.id,
        name: model.name ?? model.id,
        family: model.family ?? null,
        tier: 'standard',
        tierSource: 'heuristic',
        costInputUsd: costInput,
        costOutputUsd: costOutput,
        releaseDate: model.releaseDate ?? null,
        contextLimit: model.contextLimit ?? null,
        reasoning: model.reasoning ?? null,
        keyless,
        excluded: excluded.has(modelKey(provider.id, model.id)),
        enabled,
        longContext: isLongContextModelId(model.id),
        order: order++,
      });
    }
  }
  const manual = {
    cheapMaxOutputUsd: settings.tiers.cheapMaxOutputUsd,
    frontierMinOutputUsd: settings.tiers.frontierMinOutputUsd,
  };
  const derived = settings.tiers.mode === 'auto'
    ? deriveTierCutoffs(
        out.filter((m) => !m.excluded && m.enabled && !m.longContext && !m.keyless),
        manual,
      )
    : { ...manual, derivedFromModels: 0 };
  for (const m of out) {
    Object.assign(m, tierFor(m.providerID, m.modelID, m.costOutputUsd, m.keyless, settings, derived, false));
  }
  return {
    models: out,
    tiers: { mode: settings.tiers.mode, ...derived },
    curatedCount: out.filter((m) => m.enabled).length,
  };
}

async function buildStatic(
  opts: RoutableModelOptions,
  settings: DecisionSettings,
  visibility: ReadonlyMap<string, boolean>,
): Promise<InternalModel[]> {
  let authed: Set<string>;
  if (opts.authed) authed = new Set(opts.authed);
  else {
    try {
      const { opencodeClient } = await import('../opencode_engine');
      authed = new Set(await opencodeClient.listAuthedProviders());
    } catch {
      authed = new Set();
    }
  }
  const excluded = new Set(settings.excludedModels);
  const agents = Object.keys(ROUTE_FALLBACKS_BY_AGENT);
  if (opts.agentId && agents.includes(opts.agentId)) {
    agents.splice(agents.indexOf(opts.agentId), 1);
    agents.unshift(opts.agentId);
  }
  const seen = new Set<string>();
  const out: InternalModel[] = [];
  let order = 0;
  for (const agent of agents) {
    for (const route of ROUTE_FALLBACKS_BY_AGENT[agent]) {
      const key = modelKey(route.providerID, route.modelID);
      if (seen.has(key) || !authed.has(route.providerID)) continue;
      seen.add(key);
      const keyless = KEYLESS_PROVIDER_IDS.has(route.providerID);
      const { tier, tierSource } = tierFor(
        route.providerID, route.modelID, null, keyless, settings, settings.tiers, true,
      );
      out.push({
        providerID: route.providerID,
        modelID: route.modelID,
        name: route.modelID,
        family: null,
        tier,
        tierSource,
        costInputUsd: keyless ? 0 : null,
        costOutputUsd: keyless ? 0 : null,
        releaseDate: null,
        contextLimit: null,
        reasoning: null,
        keyless,
        excluded: excluded.has(key),
        // Static table is only used when the engine is unreachable: honor explicit hides only.
        enabled: visibility.get(visibilityKey(route.providerID, route.modelID)) !== false,
        longContext: isLongContextModelId(route.modelID) || route.variantLabel === '1M context',
        order: order++,
      });
    }
  }
  return out;
}

async function computeBase(opts: RoutableModelOptions): Promise<BaseCatalog> {
  const settings = opts.settings ?? loadDecisionSettings();
  const cacheable = !opts.snapshot && !opts.authed && !opts.entitled;
  const visibility = opts.visibility ?? loadModelVisibility();
  const key = settingsKey(settings, visibility);
  if (cacheable && cache && cache.key === key && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.value;
  }
  let snapshot: ProviderSnapshot | null = opts.snapshot ?? null;
  if (!snapshot) {
    try {
      const { opencodeClient } = await import('../opencode_engine');
      snapshot = await opencodeClient.providerSnapshot();
    } catch {
      snapshot = null;
    }
  }
  let value: BaseCatalog;
  if (snapshot && Array.isArray(snapshot.providers) && snapshot.providers.length > 0) {
    const entitled = opts.entitled ?? (await readEntitlements());
    const live = buildLive(snapshot, opts, entitled, settings, visibility);
    value = { ...live, source: 'live', fetchedAt: new Date().toISOString() };
  } else {
    value = {
      models: await buildStatic(opts, settings, visibility),
      source: 'static',
      fetchedAt: new Date().toISOString(),
      tiers: {
        mode: settings.tiers.mode,
        cheapMaxOutputUsd: settings.tiers.cheapMaxOutputUsd,
        frontierMinOutputUsd: settings.tiers.frontierMinOutputUsd,
        derivedFromModels: 0,
      },
      curatedCount: 0,
    };
  }
  if (cacheable) cache = { key, at: Date.now(), value };
  return value;
}

/** tier, then provider, then newest release first (unknown dates last), then catalog order. */
function catalogOrder(a: InternalModel, b: InternalModel): number {
  if (a.tier !== b.tier) return TIER_RANK[a.tier] - TIER_RANK[b.tier];
  if (a.providerID !== b.providerID) return a.providerID < b.providerID ? -1 : 1;
  if (a.releaseDate !== b.releaseDate) {
    if (a.releaseDate === null) return 1;
    if (b.releaseDate === null) return -1;
    return a.releaseDate < b.releaseDate ? 1 : -1;
  }
  return a.order - b.order;
}

const toPublic = ({ excluded: _e, enabled: _en, longContext: _l, order: _o, ...model }: InternalModel): RoutableModel => model;

/** The models the router may pick right now. Never throws. */
export async function getRoutableModels(opts: RoutableModelOptions = {}): Promise<RoutableCatalog> {
  const base = await computeBase(opts);
  const allowLong = !!opts.baseRoute && isLongContextModelId(opts.baseRoute.modelID);
  const models = base.models
    .filter((m) => !m.excluded && m.enabled && (allowLong || !m.longContext))
    .sort(catalogOrder)
    .map(toPublic);
  return {
    models,
    source: base.source,
    fetchedAt: base.fetchedAt,
    tiers: base.tiers,
    curatedCount: base.curatedCount,
    ...(base.source === 'live' && base.curatedCount === 0 ? { reason: 'no_curated_models' as const } : {}),
  };
}

/** Everything the settings UI lists: excluded models included (flagged), long-context variants hidden. */
export async function getCatalogForSettings(
  opts: RoutableModelOptions = {},
): Promise<{
  models: Array<RoutableModel & { excluded: boolean; enabled: boolean }>;
  source: CatalogSource;
  fetchedAt: string;
  tiers: EffectiveTiers;
  curatedCount: number;
}> {
  const base = await computeBase(opts);
  const models = base.models
    .filter((m) => !m.longContext)
    .sort(catalogOrder)
    .map((m) => ({ ...toPublic(m), excluded: m.excluded, enabled: m.enabled }));
  return { models, source: base.source, fetchedAt: base.fetchedAt, tiers: base.tiers, curatedCount: base.curatedCount };
}

/**
 * Sync tier lookup for a concrete route: the catalog tier (excluded and long-context
 * variants included), else the name heuristic.
 */
export async function getRouteTierClassifier(
  opts: RoutableModelOptions = {},
): Promise<(route: ModelRoute) => ModelTier> {
  try {
    const base = await computeBase(opts);
    const tiers = new Map(base.models.map((m) => [modelKey(m.providerID, m.modelID), m.tier]));
    return (route) => tiers.get(modelKey(route.providerID, route.modelID)) ?? classifyRouteTier(route);
  } catch {
    return classifyRouteTier;
  }
}

/** Within a provider+tier: lowest output cost first (unpriced last), then newest release, then catalog order. */
export function comparePreference(a: RoutableModel, b: RoutableModel): number {
  const ca = a.costOutputUsd;
  const cb = b.costOutputUsd;
  if (ca !== cb) {
    if (ca === null) return 1;
    if (cb === null) return -1;
    return ca - cb;
  }
  if (a.releaseDate !== b.releaseDate) {
    if (a.releaseDate === null) return 1;
    if (b.releaseDate === null) return -1;
    return a.releaseDate < b.releaseDate ? 1 : -1;
  }
  return 0;
}

/**
 * Pick the model for `tier`. Provider order: providers with a non-ultra model first,
 * then the base route's provider (keeps the session's account and prompt cache), then
 * the most usage headroom (known before unknown), then direct providers before
 * aggregators. Inside the provider: lowest output cost, then newest release. Models
 * priced at or above `ultraMinOutputUsd` (5x the frontier cutoff) stay eligible but
 * sort last, so a $180 "pro" model never wins while a $25-30 frontier model exists.
 * `models` must already be routable.
 */
export function pickModelForTier(input: {
  tier: ModelTier;
  baseRoute?: ModelRoute;
  models: readonly RoutableModel[];
  headroomByProvider?: Record<string, number | null | undefined>;
  ultraMinOutputUsd?: number;
}): RoutableModel | undefined {
  const atTier = input.models.filter((m) => m.tier === input.tier);
  if (atTier.length === 0) return undefined;
  const ultraMin = input.ultraMinOutputUsd ?? Infinity;
  const isUltra = (m: RoutableModel): boolean => m.costOutputUsd !== null && m.costOutputUsd >= ultraMin;
  const headroom = (providerID: string): number | null => {
    const h = input.headroomByProvider?.[providerID];
    return typeof h === 'number' && Number.isFinite(h) ? h : null;
  };
  const providers = [...new Set(atTier.map((m) => m.providerID))];
  const normal = new Set(atTier.filter((m) => !isUltra(m)).map((m) => m.providerID));
  providers.sort((a, b) => {
    const ultraA = normal.has(a) ? 0 : 1;
    const ultraB = normal.has(b) ? 0 : 1;
    if (ultraA !== ultraB) return ultraA - ultraB;
    const baseA = a === input.baseRoute?.providerID ? 0 : 1;
    const baseB = b === input.baseRoute?.providerID ? 0 : 1;
    if (baseA !== baseB) return baseA - baseB;
    const ha = headroom(a);
    const hb = headroom(b);
    if (ha !== hb) {
      if (ha === null) return 1;
      if (hb === null) return -1;
      return hb - ha;
    }
    const aggA = AGGREGATOR_IDS.has(a) ? 1 : 0;
    const aggB = AGGREGATOR_IDS.has(b) ? 1 : 0;
    if (aggA !== aggB) return aggA - aggB;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  const candidates = atTier
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => m.providerID === providers[0])
    .sort((a, b) => {
      const ua = isUltra(a.m) ? 1 : 0;
      const ub = isUltra(b.m) ? 1 : 0;
      return ua - ub || comparePreference(a.m, b.m) || a.i - b.i;
    });
  return candidates[0].m;
}

/** Best remaining usage fraction per ROUTE provider id (null when unknown), from the cached usage snapshot. */
export async function readHeadroomByProvider(providerIDs: Iterable<string>): Promise<Record<string, number | null>> {
  const out: Record<string, number | null> = {};
  try {
    const { accountHeadroom, usageProviderFor } = await import('./capacity_router');
    const usage = await getUsageBudget({ cachedOnly: true });
    const entries = usage && Array.isArray(usage.providers) ? accountHeadroom(usage) : [];
    for (const providerID of providerIDs) {
      const usageProvider = usageProviderFor(providerID);
      const known = entries
        .filter((e) => e.provider === usageProvider && e.headroom !== null)
        .map((e) => e.headroom as number);
      out[providerID] = usageProvider && known.length > 0 ? Math.max(...known) : null;
    }
  } catch {
    // no usage data: every provider unknown
  }
  return out;
}

export interface TierRouteResult {
  route: ModelRoute;
  tier: ModelTier;
  catalog: CatalogSource;
  model?: RoutableModel;
  /** Static path only: the legacy near-budget step-down happened. */
  downgradedForBudget?: boolean;
  reason: string;
}

/**
 * Model for a routed tier. Live catalog: pickModelForTier. Empty/unreachable
 * catalog (or no model at that tier): the static resolver over
 * ROUTE_FALLBACKS_BY_AGENT, recorded as `catalog: 'static'`. Shared by the turn
 * router and agent_runner. Throws only when the static resolver has no routes.
 */
export async function routeModelForTier(input: {
  tier: ModelTier;
  agentId: string;
  baseRoute?: ModelRoute;
}): Promise<TierRouteResult> {
  let source: CatalogSource = 'static';
  try {
    const catalog = await getRoutableModels({
      agentId: input.agentId,
      ...(input.baseRoute ? { baseRoute: input.baseRoute } : {}),
    });
    source = catalog.source;
    if (catalog.source === 'live' && catalog.reason && input.baseRoute) {
      // Nothing enabled in Models curation: keep the baseline route, never the static table.
      return {
        route: input.baseRoute,
        tier: classifyRouteTier(input.baseRoute),
        catalog: 'live',
        reason: catalog.reason,
      };
    }
    if (catalog.source === 'live') {
      const headroomByProvider = await readHeadroomByProvider(new Set(catalog.models.map((m) => m.providerID)));
      const model = pickModelForTier({
        tier: input.tier,
        ...(input.baseRoute ? { baseRoute: input.baseRoute } : {}),
        models: catalog.models,
        headroomByProvider,
        ultraMinOutputUsd: catalog.tiers.frontierMinOutputUsd * ULTRA_PRICE_MULTIPLE,
      });
      if (model) {
        return {
          route: {
            providerID: model.providerID,
            modelID: model.modelID,
            ...(isLongContextModelId(model.modelID) ? { variantLabel: '1M context' } : {}),
          },
          tier: model.tier,
          catalog: 'live',
          model,
          reason: `live catalog: ${model.tier} tier via ${model.tierSource}`,
        };
      }
    }
  } catch {
    source = 'static';
  }
  const { resolveTieredModel } = await import('../agent_model_resolver');
  const decision = await resolveTieredModel({ agentId: input.agentId, explicitTierHint: input.tier });
  return {
    route: decision.route,
    tier: decision.tier,
    catalog: 'static',
    downgradedForBudget: decision.downgradedForBudget,
    reason: source === 'live' ? 'no live model at tier; static table' : 'static table',
  };
}
