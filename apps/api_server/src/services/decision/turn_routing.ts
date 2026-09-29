import { getDecisionEscalateMinConfidence, getDecisionRoutingScope } from '../../config/env';
import { AgentSessionsRepository } from '../../repositories/agent_sessions_repository';
import type { RequestedSource } from '../../models/model_provenance';
import { logger } from '../../utils/logger';
import type { ModelRoute } from '../agent_model_resolver';
import type { DecisionOpts } from './decision_engine';
import {
  applyScopeToDecision,
  scopePersistsPick,
  shouldRouteThisPrompt,
} from './routing_scope';

/** Subset of an agent_sessions row the turn router needs. */
export interface TurnRoutingSessionRow {
  id: string;
  modelMode: 'auto' | 'fixed' | string;
  routerDecidedAt: string | null;
  providerId: string | null;
  modelId: string | null;
  anthropicAccountId?: string | null;
  openaiAccountId?: string | null;
}

export interface RouteTurnForSessionInput {
  /** Row for the session; null (unknown) = no scope state, no persistence. */
  sessionRow: TurnRoutingSessionRow | null;
  sessionId: string;
  prompt: string;
  agentId: string;
  /** Provenance source the resolver returned for the baseline route. */
  requestedSource: RequestedSource | string;
  requestedTier?: string | null;
  /** Baseline route from the resolver (stored -> profile -> default). */
  baseRoute: ModelRoute | undefined;
  /** Auto (router) mode for THIS turn (row mode, or the frame's modelMode). */
  sessionAuto: boolean;
  client?: DecisionOpts['client'];
}

export interface RouteTurnForSessionResult {
  route: ModelRoute | undefined;
  /** True when routing (router or capacity) changed the route from the baseline. */
  applied: boolean;
  source: 'router' | 'capacity' | 'baseline';
  requestedSource: RequestedSource | string;
  requestedTier: string | null;
}

/**
 * Decision routing for one turn: routing scope -> tier router -> capacity
 * layer. Shared by ws_gateway (desktop) and the mobile proxy. Never throws:
 * any failure keeps the baseline route.
 *
 * Scope: when the scope says skip (first_prompt with a persisted pick) the
 * reranker is not called and nothing is logged. The capacity layer still runs
 * every prompt (it reads only the cached usage snapshot). Applied picks are
 * persisted (provider/model + router_decided_at) for first_prompt and
 * escalate_only on auto rows; shadow mode persists nothing.
 */
export async function routeTurnForSession(
  input: RouteTurnForSessionInput,
): Promise<RouteTurnForSessionResult> {
  let route = input.baseRoute;
  let requestedSource: RequestedSource | string = input.requestedSource;
  let requestedTier: string | null = input.requestedTier ?? null;
  let source: RouteTurnForSessionResult['source'] = 'baseline';

  const { classifyRouteTier, resolveTieredModel } = await import('../agent_model_resolver');
  const scope = getDecisionRoutingScope();

  try {
    const routeIt = shouldRouteThisPrompt({
      scope,
      session: {
        modelMode: input.sessionAuto ? 'auto' : 'fixed',
        routerDecidedAt: input.sessionRow?.routerDecidedAt ?? null,
        providerId: input.sessionRow?.providerId ?? null,
        modelId: input.sessionRow?.modelId ?? null,
      },
    });
    if (routeIt) {
      const { routeTurnTier } = await import('./model_router');
      const escalateMin = getDecisionEscalateMinConfidence();
      const routed = await routeTurnTier({
        prompt: input.prompt,
        agentId: input.agentId,
        requestedSource: input.requestedSource,
        sessionId: input.sessionId,
        sessionAuto: input.sessionAuto,
        baselineTier: route ? classifyRouteTier(route) : null,
        ...(input.client ? { client: input.client } : {}),
        scopeGate: input.sessionAuto
          ? (label, confidence) =>
              applyScopeToDecision({
                scope,
                currentRoute: route,
                routedTier: label,
                confidence,
                escalateMin,
                classifyRouteTier,
              })
          : undefined,
      });
      if (routed.tier) {
        const tiered = await resolveTieredModel({
          agentId: input.agentId,
          explicitTierHint: routed.tier,
        });
        route = tiered.route;
        requestedSource = 'tier';
        requestedTier = tiered.tier;
        source = 'router';
        if (
          input.sessionAuto &&
          scopePersistsPick(scope) &&
          input.sessionRow?.modelMode === 'auto'
        ) {
          try {
            new AgentSessionsRepository().setRouterDecision(input.sessionId, {
              providerId: tiered.route.providerID,
              modelId: tiered.route.modelID,
              decidedAt: new Date().toISOString(),
            });
          } catch (persistErr) {
            logger.warn(`[turn_routing] persisting router pick failed (non-fatal): ${String(persistErr)}`);
          }
        }
      }
    }
  } catch (routeErr) {
    console.error(`[turn_routing] decision routing failed (non-fatal):`, routeErr);
  }

  // Usage-capacity routing (AGENT_DECISION_CAPACITY_ROUTING): no-op when off.
  try {
    if (route) {
      const { applyCapacityRouting, switchAutoSessionAccount, usageProviderFor } =
        await import('./capacity_router');
      const capUsage = usageProviderFor(route.providerID);
      const capDecision = await applyCapacityRouting({
        agentId: input.agentId,
        baseRoute: route,
        // The routed tier (if any) is already reflected in the route.
        requiredTier: classifyRouteTier(route),
        requestedSource: String(requestedSource ?? 'agent_default'),
        sessionId: input.sessionId,
        sessionAuto: input.sessionAuto,
        currentAccountId:
          capUsage === 'anthropic'
            ? input.sessionRow?.anthropicAccountId ?? null
            : capUsage === 'openai'
              ? input.sessionRow?.openaiAccountId ?? null
              : null,
      });
      if (capDecision) {
        if (capDecision.routeChanged) {
          route = capDecision.route;
          requestedSource = 'tier';
          requestedTier = classifyRouteTier(capDecision.route);
          source = 'capacity';
        }
        await switchAutoSessionAccount({
          sessionId: input.sessionId,
          providerID: capDecision.route.providerID,
          accountId: capDecision.accountId,
          sessionAuto: input.sessionAuto,
        });
      }
    }
  } catch (capErr) {
    console.error(`[turn_routing] capacity routing failed (non-fatal):`, capErr);
  }

  return {
    route,
    applied: source !== 'baseline',
    source,
    requestedSource,
    requestedTier,
  };
}
