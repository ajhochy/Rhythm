import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth_middleware';
import { env } from '../config/env';
import { opencodeClient } from '../services/opencode_engine';
import { ROUTE_FALLBACKS_BY_AGENT, listAllRoutes, type CatalogEntry } from '../services/agent_model_resolver';
import { getDb } from '../database/db';

export const agentsModelsRouter = Router();

if (!env.agentLocal) agentsModelsRouter.use(requireAuth);

/**
 * Provider IDs that are aggregators (route via third-party key) rather
 * than direct accounts. Kept in sync with agents_capabilities_routes.ts.
 */
const AGGREGATOR_PROVIDERS = new Set(['openrouter', 'together', 'groq']);

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
): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  await Promise.all(
    [...new Set(providerIds)].map(async (providerId) => {
      const models = await opencodeClient.listModels(providerId);
      out.set(providerId, new Set(models.map((m) => m.id)));
    }),
  );
  return out;
}

function routeExistsInProviderCatalog(
  modelIdsByProvider: Map<string, Set<string>>,
  providerId: string,
  modelId: string,
): boolean {
  return modelIdsByProvider.get(providerId)?.has(modelId) ?? false;
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
agentsModelsRouter.get('/catalog', async (_req: Request, res: Response) => {
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
    const modelIdsByProvider = await loadProviderModelIds(
      allEntries.map((entry) => entry.authProvider),
    );

    const filtered = allEntries.filter((entry) => {
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
      // If the SDK hasn't populated its model catalog yet (empty set during
      // early startup), skip the existence check to avoid hiding visible
      // curated models. Only filter when the set is non-empty.
      const skipLiveCheck = !openRouterModelIds || openRouterModelIds.size === 0;
      for (const [modelId, visible] of visibilityMap) {
        if (!visible) continue;
        if (existingModelIds.has(modelId)) continue;
        // Verify the model actually exists in the live OpenRouter catalog.
        // When the SDK hasn't populated its catalog yet (skipLiveCheck), be
        // permissive — the visibility table already confirms the user wants it.
        if (!skipLiveCheck && !openRouterModelIds?.has(modelId)) continue;
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

    const allModels = [...filtered, ...curatedEntries];
    const response = allModels.map((entry) => ({
      agent: entry.agent,
      provider: entry.authProvider,
      modelId: entry.modelID,
      displayName: entry.modelID,
      variantLabel: entry.variantLabel,
      route: entry.route,
      authorized: entry.authorized,
      authProvider: entry.authProvider,
      connectUrl: entry.connectUrl,
    }));

    res.json(response);
  } catch (err) {
    console.error('[agents/models/catalog] Unexpected error:', err);
    res.json([]);
  }
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
    const modelIdsByProvider = await loadProviderModelIds(authedSet);

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

    res.json(rows);
  } catch (err) {
    console.error('[agents/models] Unexpected error:', err);
    res.json([]);
  }
});
