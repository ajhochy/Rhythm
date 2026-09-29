import { ROUTE_FALLBACKS_BY_AGENT, classifyRouteTier, type ModelTier } from '../../src/services/agent_model_resolver';

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
