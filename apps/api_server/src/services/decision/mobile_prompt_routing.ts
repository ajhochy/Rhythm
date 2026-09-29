import { AgentSessionsRepository } from '../../repositories/agent_sessions_repository';
import { logger } from '../../utils/logger';
import type { DecisionOpts } from './decision_engine';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/** Concatenated text of the body's user-visible text parts (classifier input). */
export function promptTextFromParts(body: Record<string, unknown>): string {
  const parts = Array.isArray(body.parts) ? body.parts : [];
  return parts
    .filter(
      (p): p is Record<string, unknown> =>
        isRecord(p) && p.type === 'text' && typeof p.text === 'string' && p.synthetic !== true,
    )
    .map((p) => p.text as string)
    .join('\n')
    .trim();
}

function bodyModel(body: Record<string, unknown>): { providerId: string; modelId: string } | null {
  const m = body.model;
  if (!isRecord(m)) return null;
  const providerId = typeof m.providerID === 'string' ? m.providerID : '';
  const modelId = typeof m.modelID === 'string' ? m.modelID : '';
  return providerId && modelId ? { providerId, modelId } : null;
}

/**
 * Mobile routing through the proxy. For a `session.prompt_async` body addressed
 * to an Auto (router) session, applies the same scope/router/capacity logic as
 * ws_gateway and rewrites `model: {providerID, modelID}`.
 *
 * Body model: absent -> the routed pick, else the session's stored model (the
 * engine default is left alone when nothing is stored); equal to the stored or
 * profile model (an echo) -> replaced only when routing applies; a different
 * model is an explicit turn choice and is forwarded unchanged. Fixed / unknown
 * / foreign sessions are untouched. Any failure returns the original body.
 */
export async function routeMobilePromptBody(input: {
  sdkSessionId: string;
  userId: number;
  body: unknown;
  client?: DecisionOpts['client'];
}): Promise<unknown> {
  try {
    if (!isRecord(input.body)) return input.body;
    const repo = new AgentSessionsRepository();
    const row = repo.findBySdkSessionId(input.sdkSessionId);
    if (!row || row.ownerUserId !== input.userId || row.modelMode !== 'auto') return input.body;

    const {
      PROVIDER_TO_AGENT_KIND,
      ROUTE_FALLBACKS_BY_AGENT,
      resolveModelForSessionTurnWithProvenance,
    } = await import('../agent_model_resolver');
    const agentId =
      (row.agentKind && ROUTE_FALLBACKS_BY_AGENT[row.agentKind] ? row.agentKind : null) ??
      (row.providerId ? PROVIDER_TO_AGENT_KIND[row.providerId] : undefined) ??
      'opencode';

    const explicit = bodyModel(input.body);
    const resolution = await resolveModelForSessionTurnWithProvenance({
      agentId,
      sessionProviderId: row.providerId,
      sessionModelId: row.modelId,
      perTurnOverride: explicit,
      sessionModelMode: 'auto',
    });
    // A model different from stored/profile is an explicit turn choice.
    if (resolution.requestedSource === 'turn_override') return input.body;

    const { routeTurnForSession } = await import('./turn_routing');
    const routing = await routeTurnForSession({
      sessionRow: row,
      sessionId: row.id,
      prompt: promptTextFromParts(input.body),
      agentId,
      requestedSource: resolution.requestedSource,
      requestedTier: resolution.requestedTier,
      baseRoute: resolution.route,
      sessionAuto: true,
      ...(input.client ? { client: input.client } : {}),
    });

    let target: { providerID: string; modelID: string } | null = null;
    if (routing.applied && routing.route) {
      target = { providerID: routing.route.providerID, modelID: routing.route.modelID };
    } else if (!explicit && row.providerId && row.modelId) {
      // Later prompts reuse the stored / persisted router pick.
      target = { providerID: row.providerId, modelID: row.modelId };
    }
    if (!target) return input.body;
    return { ...input.body, model: target };
  } catch (err) {
    logger.warn(`[mobile_prompt_routing] routing failed; forwarding original body: ${String(err)}`);
    return input.body;
  }
}
