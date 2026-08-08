import { Router, Request, Response } from 'express';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { requireAuth } from '../middleware/auth_middleware';
import { env } from '../config/env';
import { opencodeClient } from '../services/opencode_engine';
import {
  PROVIDER_TO_AGENT_KIND,
  ROUTE_FALLBACKS_BY_AGENT,
  listAllRoutes,
  type CatalogEntry,
} from '../services/agent_model_resolver';
import { getDb } from '../database/db';

export const agentsModelsRouter = Router();

if (!env.agentLocal) agentsModelsRouter.use(requireAuth);

/**
 * Provider IDs that are aggregators (route via third-party key) rather
 * than direct accounts. Kept in sync with agents_capabilities_routes.ts.
 */
const AGGREGATOR_PROVIDERS = new Set(['openrouter', 'together', 'groq']);

const CHAT_MODEL_PREFIX_BY_PROVIDER: Record<string, string> = {
  anthropic: 'claude-',
  openai: 'gpt-',
  google: 'gemini-',
};

function isEligibleDirectModel(providerId: string, modelId: string): boolean {
  const prefix = CHAT_MODEL_PREFIX_BY_PROVIDER[providerId];
  if (!prefix || !modelId.startsWith(prefix)) return false;
  if (modelId.endsWith('-fast')) return false;
  return !/(?:^|-)(?:embedding|image|tts)(?:-|$)/i.test(modelId);
}

/**
 * Human-readable label for an aggregator provider ID.
 */
function aggregatorLabel(providerId: string): string {
  const map: Record<string, string> = {
    openrouter: 'OpenRouter',
    together: 'Together',
    groq: 'Groq',
  };
  return map[providerId] ?? providerId;
}

async function loadProviderModelIds(
  providerIds: Iterable<string>,
): Promise<{
  modelIdsByProvider: Map<string, Set<string>>;
  contextLimitByKey: Map<string, number>;
}> {
  const modelIdsByProvider = new Map<string, Set<string>>();
  const contextLimitByKey = new Map<string, number>();
  await Promise.all(
    [...new Set(providerIds)].map(async (providerId) => {
      const models = await opencodeClient.listModels(providerId);
      modelIdsByProvider.set(providerId, new Set(models.map((m) => m.id)));
      for (const m of models) {
        if (m.contextLimit != null) {
          contextLimitByKey.set(`${providerId}/${m.id}`, m.contextLimit);
        }
      }
    }),
  );
  return { modelIdsByProvider, contextLimitByKey };
}

function routeExistsInProviderCatalog(
  modelIdsByProvider: Map<string, Set<string>>,
  providerId: string,
  modelId: string,
): boolean {
  return modelIdsByProvider.get(providerId)?.has(modelId) ?? false;
}

/**
 * #1143 — provider IDs the static maps already cover, so the custom-provider
 * merge doesn't re-emit them. Union of PROVIDER_TO_AGENT_KIND (direct kinds)
 * and every provider referenced by any ROUTE_FALLBACKS_BY_AGENT route
 * (catches aggregators like openrouter and any statically-listed provider).
 */
function knownStaticProviderIds(): Set<string> {
  const known = new Set<string>(Object.keys(PROVIDER_TO_AGENT_KIND));
  for (const routes of Object.values(ROUTE_FALLBACKS_BY_AGENT)) {
    for (const route of routes) known.add(route.providerID);
  }
  for (const agg of AGGREGATOR_PROVIDERS) known.add(agg);
  return known;
}

/**
 * #1143 — build catalog rows for CUSTOM providers (in the engine's live
 * catalog but not in the static maps), as generic `opencode`-kind direct
 * entries. `existingKeys` is the `<provider>\0<model>` set already emitted so a
 * provider that IS statically known never double-emits. Never throws.
 */
async function buildCustomProviderEntries(
  existingKeys: Set<string>,
  authedSet: Set<string>,
  contextLimitByKey?: Map<string, number>,
): Promise<CatalogEntry[]> {
  const known = knownStaticProviderIds();
  let configuredProviders = new Set<string>();
  try {
    const config = JSON.parse(readFileSync(join(homedir(), '.config/opencode/opencode.json'), 'utf8'));
    if (config.provider && typeof config.provider === 'object') {
      configuredProviders = new Set(Object.keys(config.provider));
    }
  } catch {
    // Config is optional and may be unavailable while the engine is starting.
  }
  // Degrade gracefully: a listProviders failure must never empty the whole
  // catalog (the file's contract) — it just means zero custom entries.
  let providers: Awaited<ReturnType<typeof opencodeClient.listProviders>> = [];
  try {
    providers = (await opencodeClient.listProviders?.()) ?? [];
  } catch {
    return [];
  }
  const entries: CatalogEntry[] = [];
  for (const provider of providers) {
    if (known.has(provider.id)) continue;
    for (const model of provider.models) {
      const key = `${provider.id}\0${model.id}`;
      if (existingKeys.has(key)) continue;
      existingKeys.add(key);
      if (contextLimitByKey && model.contextLimit != null) {
        contextLimitByKey.set(`${provider.id}/${model.id}`, model.contextLimit);
      }
      entries.push({
        agent: PROVIDER_TO_AGENT_KIND[provider.id] ?? 'opencode',
        providerID: provider.id,
        modelID: model.id,
        route: 'direct',
        authorized: authedSet.has(provider.id) || configuredProviders.has(provider.id),
        authProvider: provider.id,
      });
    }
  }
  return entries;
}

/**
 * GET /agents/models?agentId=<id>
 *
 * Returns the catalogue of (providerId, modelId, routeKind) rows for the
 * given agentId, filtered to only providers that are currently authed.
 *
 * Response shape:
 *   [
 *     {
 *       providerId: string,
 *       modelId: string,
 *       routeKind: 'direct' | 'aggregator',
 *       aggregatorVia?: string,   // human-readable aggregator name when routeKind='aggregator'
 *       label: string,            // display string for the picker row
 *     },
 *     ...
 *   ]
 *
 * A model reachable by both a direct account and an aggregator appears as
 * two separate rows so the caller can offer both routes explicitly.
 *
 * If agentId is omitted or has no fallback map, returns an empty array.
 */
/**
 * GET /agents/models/catalog
 *
 * Returns the full cross-agent model catalog annotated with authorization state.
 * No `agentId` filter — every (agent, provider, model) triple is included so
 * the unified picker can show Authorized vs "Connect" rows.
 *
 * Applies the visibility map from #609 to OpenRouter rows: if a model_id has
 * a `visible=0` row in `agent_model_visibility`, it is excluded.
 *
 * Response row shape:
 *   {
 *     agent: 'claude-code' | 'codex' | 'gemini-cli' | 'opencode',
 *     provider: string,
 *     modelId: string,
 *     displayName: string,
 *     variantLabel?: string,
 *     route: 'direct' | 'aggregator',
 *     authorized: boolean,
 *     authProvider: string,
 *     connectUrl?: string,
 *   }
 */
export async function listAgentModelCatalog() {
  try {
    const authedProviders = await opencodeClient.listAuthedProviders();
    const authedSet = new Set(authedProviders);

    // Load visibility map for openrouter (same as existing GET / endpoint).
    let visibilityMap: Map<string, boolean> | null = null;
    try {
      const rows = getDb().prepare(
        `SELECT model_id, visible FROM agent_model_visibility WHERE provider = 'openrouter'`,
      ).all() as { model_id: string; visible: number }[];
      if (rows.length > 0) {
        visibilityMap = new Map(rows.map((r) => [r.model_id, r.visible === 1]));
      }
    } catch {
      // Table may not exist yet on first run — degrade gracefully.
    }

    const allEntries = await listAllRoutes(authedSet);
    const { modelIdsByProvider, contextLimitByKey } = await loadProviderModelIds(
      allEntries.map((entry) => entry.authProvider),
    );

    const filtered = allEntries.filter((entry) => {
      // #639 — drop openrouter aggregator entries that duplicate a directly-authed provider.
      // E.g. if user has direct anthropic auth, suppress anthropic/* routes via OpenRouter.
      if (entry.authProvider === 'openrouter') {
        const prefix = entry.modelID.split('/')[0];
        if (authedSet.has(prefix)) return false;
      }
      // If the SDK returned an empty model list for this provider (couldn't
      // enumerate — e.g. direct Anthropic/OpenAI API isn't configured but the
      // user routes through OpenRouter), skip the existence check rather than
      // hiding valid entries. Only filter entries out when we actually have a
      // non-empty catalog to compare against.
      const providerModelSet = modelIdsByProvider.get(entry.authProvider);
      if (providerModelSet && providerModelSet.size > 0) {
        if (!providerModelSet.has(entry.modelID)) {
          return false;
        }
      }
      // Apply visibility filter to openrouter models only.
      if (
        entry.route === 'aggregator' &&
        entry.authProvider === 'openrouter' &&
        visibilityMap !== null
      ) {
        const visible = visibilityMap.get(entry.modelID);
        if (visible === false) return false;
      }
      return true;
    });

    const liveDirectEntries: CatalogEntry[] = [];
    const existingDirectKeys = new Set(
      filtered
        .filter((entry) => entry.route === 'direct')
        .map((entry) => `${entry.authProvider}\0${entry.modelID}`),
    );
    const directTemplates = new Map(
      allEntries
        .filter((entry) => entry.route === 'direct')
        .map((entry) => [entry.authProvider, entry] as const),
    );
    for (const [providerId, agent] of Object.entries(PROVIDER_TO_AGENT_KIND)) {
      const template = directTemplates.get(providerId);
      const liveModelIds = modelIdsByProvider.get(providerId);
      if (!template || !liveModelIds || liveModelIds.size === 0) continue;

      for (const modelId of liveModelIds) {
        const key = `${providerId}\0${modelId}`;
        if (existingDirectKeys.has(key)) continue;
        if (!isEligibleDirectModel(providerId, modelId)) continue;
        existingDirectKeys.add(key);
        liveDirectEntries.push({
          agent,
          providerID: providerId,
          modelID: modelId,
          route: 'direct',
          authorized: authedSet.has(providerId),
          authProvider: providerId,
          connectUrl: template.connectUrl,
        });
      }
    }

    // Issue #609 — include curated OpenRouter models that are NOT in the
    // hardcoded ROUTE_FALLBACKS_BY_AGENT list. The curation UI lets users
    // browse the full OpenRouter catalog and mark models visible; those
    // selected models need to appear in the picker even if they aren't in
    // the fallback list.
    const curatedEntries: CatalogEntry[] = [];
    if (authedSet.has('openrouter') && visibilityMap !== null) {
      const existingModelIds = new Set(
        filtered
          .filter((e) => e.authProvider === 'openrouter')
          .map((e) => e.modelID),
      );
      const openRouterModelIds = modelIdsByProvider.get('openrouter');
      // Only promote curated models that the SDK's live OpenRouter catalog
      // confirms exist. If the catalog is empty (e.g. early startup or SDK
      // failure), no curated entries are promoted — admitting unverified ids
      // produces silent failures when the model is actually selected.
      for (const [modelId, visible] of visibilityMap) {
        if (!visible) continue;
        if (existingModelIds.has(modelId)) continue;
        if (!openRouterModelIds || !openRouterModelIds.has(modelId)) continue;
        // Derive agent kind from model ID prefix (matching ws_gateway.ts).
        let agent = 'claude-code';
        if (modelId.startsWith('openai/')) agent = 'codex';
        else if (modelId.startsWith('google/')) agent = 'gemini-cli';
        curatedEntries.push({
          agent,
          providerID: 'openrouter',
          modelID: modelId,
          route: 'aggregator',
          authorized: true,
          authProvider: 'openrouter',
          connectUrl: '/opencode/auth/openrouter',
        });
      }
    }

    // #1143 — merge CUSTOM providers the static maps don't know about. A
    // user-defined openai-compatible provider in opencode.json (e.g. glm-mesh)
    // is in the engine's live catalog but absent from PROVIDER_TO_AGENT_KIND /
    // ROUTE_FALLBACKS_BY_AGENT, so neither loop above ever emits it. Enumerate
    // the live provider catalog and add any provider that is NOT already a
    // known static provider and NOT an aggregator as generic `opencode`-kind
    // direct rows, so it appears in the picker just like `opencode models`
    // shows it. It is authorized only when authenticated or explicitly defined
    // in opencode.json; engine advertisement alone is not a usable credential.
    const customProviderEntries = await buildCustomProviderEntries(
      existingDirectKeys,
      authedSet,
      contextLimitByKey,
    );

    const allModels = [...filtered, ...liveDirectEntries, ...curatedEntries, ...customProviderEntries];
    const response = allModels.map((entry) => {
      const contextLimit = contextLimitByKey.get(`${entry.authProvider}/${entry.modelID}`);
      return {
        agent: entry.agent,
        provider: entry.authProvider,
        modelId: entry.modelID,
        displayName: entry.modelID,
        variantLabel: entry.variantLabel,
        route: entry.route,
        authorized: entry.authorized,
        authProvider: entry.authProvider,
        connectUrl: entry.connectUrl,
        ...(contextLimit != null ? { contextLimit } : {}),
      };
    });

    return response;
  } catch (err) {
    console.error('[agents/models/catalog] Unexpected error:', err);
    return [];
  }
}

agentsModelsRouter.get('/catalog', async (_req: Request, res: Response) => {
  res.json(await listAgentModelCatalog());
});

agentsModelsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const agentId = (req.query.agentId as string | undefined)?.trim();
    if (!agentId) {
      res.json([]);
      return;
    }

    const routes = ROUTE_FALLBACKS_BY_AGENT[agentId];
    if (!routes || routes.length === 0) {
      res.json([]);
      return;
    }

    const authedProviders = await opencodeClient.listAuthedProviders();
    const authedSet = new Set(authedProviders);
    const { modelIdsByProvider } = await loadProviderModelIds(authedSet);

    // Issue #609 — load visibility map for openrouter (other providers always visible).
    let visibilityMap: Map<string, boolean> | null = null;
    try {
      const rows = getDb().prepare(
        `SELECT model_id, visible FROM agent_model_visibility WHERE provider = 'openrouter'`,
      ).all() as { model_id: string; visible: number }[];
      if (rows.length > 0) {
        visibilityMap = new Map(rows.map((r) => [r.model_id, r.visible === 1]));
      }
    } catch {
      // DB may not have the table yet on first run — degrade gracefully.
    }

    const rows: Array<{
      providerId: string;
      modelId: string;
      routeKind: 'direct' | 'aggregator';
      aggregatorVia?: string;
      label: string;
      variantLabel?: string;
    }> = [];

    for (const route of routes) {
      const { providerID, modelID, variantLabel } = route;
      if (!authedSet.has(providerID)) continue;
      // #639 — drop openrouter aggregator entries that duplicate a directly-authed provider.
      // E.g. if user has direct anthropic auth, suppress anthropic/* routes via OpenRouter.
      if (providerID === 'openrouter') {
        const prefix = modelID.split('/')[0];
        if (authedSet.has(prefix)) continue;
      }
      // If the SDK returned an empty model list for this provider, skip the
      // existence check; an empty list means "can't enumerate" not "no models."
      const providerSet = modelIdsByProvider.get(providerID);
      if (providerSet && providerSet.size > 0) {
        if (!providerSet.has(modelID)) {
          continue;
        }
      }

      // Issue #609 — filter openrouter models by visibility if a visibility row exists.
      // If no row exists for this model_id, default to visible=true.
      if (AGGREGATOR_PROVIDERS.has(providerID) && providerID === 'openrouter' && visibilityMap !== null) {
        const isVisible = visibilityMap.get(modelID);
        if (isVisible === false) continue;
      }

      const isAggregator = AGGREGATOR_PROVIDERS.has(providerID);
      if (isAggregator) {
        const via = aggregatorLabel(providerID);
        rows.push({
          providerId: providerID,
          modelId: modelID,
          routeKind: 'aggregator',
          aggregatorVia: via,
          label: `${modelID} · via ${via}`,
          ...(variantLabel ? { variantLabel } : {}),
        });
      } else {
        rows.push({
          providerId: providerID,
          modelId: modelID,
          routeKind: 'direct',
          label: `${modelID} · direct`,
          ...(variantLabel ? { variantLabel } : {}),
        });
      }
    }

    // Issue #637 — append curated OpenRouter models that are NOT in
    // ROUTE_FALLBACKS_BY_AGENT. The curation UI can mark models visible; those
    // must appear in the picker even when they're absent from the fallback list.
    // Mirror the same "curatedEntries" promotion block in the /catalog handler.
    if (authedSet.has('openrouter') && visibilityMap !== null) {
      const existingModelIds = new Set(
        rows
          .filter((r) => r.providerId === 'openrouter')
          .map((r) => r.modelId),
      );
      const openRouterModelIds = modelIdsByProvider.get('openrouter');
      // Conservative gate: only promote when the SDK returned a non-empty
      // catalog. An empty list means "can't enumerate" — admitting unverified
      // ids causes silent failures when the model is actually selected.
      if (openRouterModelIds && openRouterModelIds.size > 0) {
        for (const [modelId, visible] of visibilityMap) {
          if (!visible) continue;
          if (existingModelIds.has(modelId)) continue;
          if (!openRouterModelIds.has(modelId)) continue;
          // Derive agent kind from model ID prefix (matching ws_gateway.ts).
          let derivedAgent = 'claude-code';
          if (modelId.startsWith('openai/')) derivedAgent = 'codex';
          else if (modelId.startsWith('google/')) derivedAgent = 'gemini-cli';
          // Only emit if it matches the requested agentId.
          if (derivedAgent !== agentId) continue;
          const via = aggregatorLabel('openrouter');
          rows.push({
            providerId: 'openrouter',
            modelId,
            routeKind: 'aggregator',
            aggregatorVia: via,
            label: `${modelId} · via ${via}`,
          });
        }
      }
    }

    // #1143 — custom providers (opencode.json-defined, absent from the static
    // maps) map to the generic `opencode` agent kind, so append their models
    // when the picker asks for that agent. Emitted as direct rows, mirroring
    // the /catalog merge. Config-defined ⇒ usable, so no authed-set gate.
    if (agentId === 'opencode') {
      const known = knownStaticProviderIds();
      const existingKeys = new Set(rows.map((r) => `${r.providerId}\0${r.modelId}`));
      const liveProviders = await opencodeClient.listProviders?.().catch(() => []) ?? [];
      for (const provider of liveProviders) {
        if (known.has(provider.id)) continue;
        for (const model of provider.models) {
          const key = `${provider.id}\0${model.id}`;
          if (existingKeys.has(key)) continue;
          existingKeys.add(key);
          rows.push({
            providerId: provider.id,
            modelId: model.id,
            routeKind: 'direct',
            label: `${model.id} · direct`,
          });
        }
      }
    }

    res.json(rows);
  } catch (err) {
    console.error('[agents/models] Unexpected error:', err);
    res.json([]);
  }
});
