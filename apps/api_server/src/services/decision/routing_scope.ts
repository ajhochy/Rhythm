import type { DecisionRoutingScope } from './decision_settings';

/**
 * Routing scope (docs/ai/plans/2026-09-29-local-decision-engine.md, "Routing
 * scope"): decides WHEN the router may run for an auto session and whether its
 * answer may replace the current route. Pure and dependency-free so ws_gateway
 * and the mobile proxy share one rule.
 */
export type RouteTierName = 'cheap' | 'standard' | 'frontier';

const TIER_RANK: Record<RouteTierName, number> = { cheap: 0, standard: 1, frontier: 2 };

export interface ScopeSession {
  modelMode: 'auto' | 'fixed' | string;
  routerDecidedAt: string | null;
  providerId?: string | null;
  modelId?: string | null;
}

/**
 * Should the router run (call the reranker) for this prompt at all?
 * first_prompt: only until the session has a persisted router pick.
 * escalate_only / every_prompt: every prompt.
 * Non-auto sessions are not scope-managed (the router only ever touches their
 * soft agent_default source), so behaviour is unchanged: true.
 */
export function shouldRouteThisPrompt(input: {
  scope: DecisionRoutingScope;
  session: ScopeSession;
}): boolean {
  if (input.session.modelMode !== 'auto') return true;
  if (input.scope === 'first_prompt') return !input.session.routerDecidedAt;
  return true;
}

export interface ScopeDecision {
  apply: boolean;
  reason: string;
}

/** May a (confident) routed tier replace the current route under this scope? */
export function applyScopeToDecision<R>(input: {
  scope: DecisionRoutingScope;
  currentRoute: R | undefined | null;
  routedTier: RouteTierName;
  confidence: number;
  escalateMin: number;
  classifyRouteTier: (route: R) => RouteTierName;
}): ScopeDecision {
  if (input.scope !== 'escalate_only') {
    return { apply: true, reason: input.scope };
  }
  if (input.confidence < input.escalateMin) {
    return { apply: false, reason: 'below_escalate_confidence' };
  }
  if (!input.currentRoute) return { apply: true, reason: 'escalate_no_current' };
  const current = input.classifyRouteTier(input.currentRoute);
  if (TIER_RANK[input.routedTier] > TIER_RANK[current]) {
    return { apply: true, reason: 'escalate' };
  }
  return { apply: false, reason: 'not_higher' };
}

/** Whether the scope persists an applied pick onto the session row. */
export function scopePersistsPick(scope: DecisionRoutingScope): boolean {
  return scope !== 'every_prompt';
}
