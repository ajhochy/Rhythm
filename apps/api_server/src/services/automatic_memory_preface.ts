import { AgentSessionMemoryProvenanceRepository } from '../repositories/agent_session_memory_provenance_repository';
import {
  buildMemoryPreface,
  isMemoryInjectionEnabled,
  type MemoryPreface,
} from './memory_retrieval';
import type { AgentMemory } from '../repositories/agent_memory_repository';
import { isGenericMemoryAdmissionAllowedFields } from '../utils/generic_memory_admission';

/**
 * Generic memory surfaces never release Dayflow activity (policy and rationale
 * live with the one pure decision in `utils/generic_memory_admission`, which
 * the SQLite scalar and retrieval share so membership is decided before any
 * LIMIT/OFFSET/count/search budget).
 */
export function isGenericMemoryAdmissionAllowed(memory: AgentMemory): boolean {
  return isGenericMemoryAdmissionAllowedFields(memory);
}

/** Automatic prompt ingress is a generic-memory surface with the same fence. */
export function isAutomaticMemoryAdmissionAllowed(memory: AgentMemory): boolean {
  return isGenericMemoryAdmissionAllowed(memory);
}

/**
 * Builds automatic, owner-scoped memory context and records body-free
 * provenance for one trusted local session. Retrieval and provenance are both
 * fail-open: neither can block the already-authorized prompt dispatch.
 */
export async function prepareAutomaticMemoryPreface(input: {
  query: string;
  sessionId: string;
  ownerUserId: number | null | undefined;
}): Promise<MemoryPreface | null> {
  if (!isMemoryInjectionEnabled()) return null;

  let preface: MemoryPreface;
  try {
    preface = await buildMemoryPreface(input.query, input.ownerUserId, {
      // The function stays as the final defense; `genericAdmission` makes the
      // same policy decide membership BEFORE each lane's shortlist/budget.
      automaticAdmission: isAutomaticMemoryAdmissionAllowed,
      genericAdmission: true,
    });
  } catch {
    return null;
  }

  try {
    new AgentSessionMemoryProvenanceRepository().record(
      input.sessionId,
      preface.memoryIds,
      preface.notePaths,
      preface.items,
      {
        semanticStatus: preface.semanticStatus,
        semanticHitCount: preface.semanticHitCount,
      },
    );
  } catch {
    // Provenance is diagnostic only; keep the prompt dispatch fail-open.
  }
  return preface;
}

/**
 * Creates a per-forward body copy for hidden context without changing caller
 * parts or replacing a valid client-provided system string.
 */
export function appendAutomaticMemoryPrefaceToPromptBody(
  body: unknown,
  preface: MemoryPreface | null,
): unknown {
  if (
    !preface?.text ||
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body)
  ) {
    return body;
  }
  const promptBody = body as Record<string, unknown>;
  const currentSystem = promptBody.system;
  if (currentSystem !== undefined && typeof currentSystem !== 'string') {
    return body;
  }
  return {
    ...promptBody,
    system: typeof currentSystem === 'string' && currentSystem.length > 0
      ? `${currentSystem}\n\n${preface.text}`
      : preface.text,
  };
}
