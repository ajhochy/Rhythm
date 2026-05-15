import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth_middleware';
import { env } from '../config/env';
import { opencodeClient } from '../services/opencode_engine';
import { ROUTE_FALLBACKS_BY_AGENT } from '../services/agent_model_resolver';

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

    const rows: Array<{
      providerId: string;
      modelId: string;
      routeKind: 'direct' | 'aggregator';
      aggregatorVia?: string;
      label: string;
    }> = [];

    for (const { providerID, modelID } of routes) {
      if (!authedSet.has(providerID)) continue;

      const isAggregator = AGGREGATOR_PROVIDERS.has(providerID);
      if (isAggregator) {
        const via = aggregatorLabel(providerID);
        rows.push({
          providerId: providerID,
          modelId: modelID,
          routeKind: 'aggregator',
          aggregatorVia: via,
          label: `${modelID} · via ${via}`,
        });
      } else {
        rows.push({
          providerId: providerID,
          modelId: modelID,
          routeKind: 'direct',
          label: `${modelID} · direct`,
        });
      }
    }

    res.json(rows);
  } catch (err) {
    console.error('[agents/models] Unexpected error:', err);
    res.json([]);
  }
});
