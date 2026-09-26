/**
 * #1576 S2 — GET /agent-sessions/:id/model-provenance projection.
 *
 * `servedModels`/`routed` come from the agent_served_steps ledger (populated
 * by the bridge as step-finish parts arrive with a served identity).
 * `steps.unattributed` is counted directly from parts_json instead: a
 * step-finish part that never carried a served identity never reaches the
 * ledger, so the only place that gap is visible is the raw parts.
 *
 * The ledger is SQLite-only (see model_provenance_repository.ts's
 * `localOnly()`), but this route is reachable under the hosted Postgres
 * role too (agent_sessions has a real Postgres table). Degrade like
 * async_delegation_status_service.ts does for the equivalent read: return a
 * structured `available:false` 200 rather than letting `localOnly()`'s throw
 * reach the controller as an unhandled 500 (review finding, #1576 follow-up).
 */
import { env } from '../config/env';
import { ModelProvenanceRepository } from '../repositories/model_provenance_repository';
import { AgentSessionMessagesRepository } from '../repositories/agent_session_messages_repository';

export interface ModelProvenanceProjection {
  available: boolean;
  /** Present only when `available` is false. */
  reason?: 'local_only';
  /** The alias/model requested for the session (e.g. session.modelId), or null if unknown. Never fabricated. */
  requestedModelId: string | null;
  servedModels: string[];
  multiModel: boolean;
  routed: boolean;
  steps: { unattributed: number };
}

const provenanceRepo = new ModelProvenanceRepository();
const messagesRepo = new AgentSessionMessagesRepository();

function isServedStepFinish(part: unknown): part is { served?: { modelID?: unknown } } {
  return typeof part === 'object' && part !== null && (part as { type?: unknown }).type === 'step-finish';
}

export function getModelProvenance(sessionId: string, requestedModelId: string | null = null): ModelProvenanceProjection {
  if (env.dbClient !== 'sqlite') {
    // The served-step ledger is local-only; the hosted/Postgres role has no
    // way to answer this, but that is a known, labeled gap — not an error.
    return {
      available: false,
      reason: 'local_only',
      requestedModelId,
      servedModels: [],
      multiModel: false,
      routed: false,
      steps: { unattributed: 0 },
    };
  }

  const { servedModels, routed } = provenanceRepo.servedSummary(sessionId);

  let unattributed = 0;
  for (const message of messagesRepo.listBySessionStructured(sessionId, 5000)) {
    for (const part of message.parts) {
      if (!isServedStepFinish(part)) continue;
      if (typeof part.served?.modelID !== 'string') unattributed += 1;
    }
  }

  return {
    available: true,
    requestedModelId,
    servedModels,
    multiModel: servedModels.length > 1,
    routed,
    steps: { unattributed },
  };
}
