import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth_middleware';
import { env } from '../config/env';
import { opencodeClient } from '../services/opencode_engine';
import { ROUTE_FALLBACKS_BY_AGENT, listAllRoutes } from '../services/agent_model_resolver';
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

    const filtered = allEntries.filter((entry) => {
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

    const response = filtered.map((entry) => ({
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
