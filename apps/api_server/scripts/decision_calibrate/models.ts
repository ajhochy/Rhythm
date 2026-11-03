import { ROUTE_FALLBACKS_BY_AGENT, classifyRouteTier, type ModelTier } from '../../src/services/agent_model_resolver';
import { getRoutableModels, pickModelForTier, type RoutableModel } from '../../src/services/decision/model_catalog';

/**
 * Mirrors agent_model_resolver's (unexported) pickRouteAtTier with every provider
 * treated as authed: the first route at exactly `tier` in the agent's route table.
 */
export function expectedModelForTier(agentId: string, tier: ModelTier): string {
  const route = (ROUTE_FALLBACKS_BY_AGENT[agentId] ?? []).find((r) => classifyRouteTier(r) === tier);
  return route ? route.modelID : '(none)';
}

export function knownAgents(): string[] {
  return Object.keys(ROUTE_FALLBACKS_BY_AGENT);
}

/** Where expected models come from: the live engine catalog, or the static table. */
export interface ExpectationCatalog {
  source: 'live' | 'static';
  models: RoutableModel[];
  /** "catalog: live (N models)" / "catalog: static" */
  label: string;
  expectedModelForTier(agentId: string, tier: ModelTier): string;
  routeTiers(agentId: string): Array<{ providerID: string; modelID: string; tier: ModelTier }>;
}

const staticCatalog = (label = 'catalog: static'): ExpectationCatalog => ({
  source: 'static',
  models: [],
  label,
  expectedModelForTier,
  routeTiers: (agentId) =>
    (ROUTE_FALLBACKS_BY_AGENT[agentId] ?? []).map((r) => ({
      providerID: r.providerID,
      modelID: r.modelID,
      tier: classifyRouteTier(r),
    })),
});

/**
 * Live catalog when the engine is reachable (unless `forceStatic`), else the static
 * table with a warning. Never throws: an unreachable engine is not an error here.
 */
export async function loadExpectationCatalog(opts: { forceStatic?: boolean } = {}): Promise<ExpectationCatalog> {
  if (opts.forceStatic) return staticCatalog();
  try {
    const live = await getRoutableModels();
    if (live.source === 'live' && live.models.length > 0) {
      const models = live.models;
      return {
        source: 'live',
        models,
        label: `catalog: live (${models.length} models)`,
        expectedModelForTier: (agentId, tier) => {
          const base = ROUTE_FALLBACKS_BY_AGENT[agentId]?.[0];
          const pick = pickModelForTier({ tier, ...(base ? { baseRoute: base } : {}), models });
          return pick ? pick.modelID : '(none)';
        },
        routeTiers: () => models.map((m) => ({ providerID: m.providerID, modelID: m.modelID, tier: m.tier })),
      };
    }
    console.warn('warning: engine catalog is empty or unreachable; using the static route table.');
  } catch (err) {
    console.warn(`warning: could not read the live model catalog (${String(err)}); using the static route table.`);
  }
  return staticCatalog();
}
