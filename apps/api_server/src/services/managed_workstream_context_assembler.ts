import type { WorkstreamRunPolicy } from '../contracts/agent_workstream_contract';
import type { ManagedContextReference } from '../repositories/managed_workstream_context_repository';
import type { AgentWorkstream } from '../models/agent_workstream';

export const MANAGED_WORKSTREAM_MAX_ADDED_TOKENS = 8_000;

export class ManagedWorkstreamPromptOverflow extends Error {
  constructor() { super('managed_workstream_prompt_overflow'); }
}

export interface ManagedWorkstreamAssembledRequest {
  prompt: string;
  references: ManagedContextReference[];
  estimatedAddedTokens: number;
}

/**
 * Builds only bounded authored controls and server-resolved, versioned source
 * identities. It never receives source content or caller-shaped receipts.
 */
export class ManagedWorkstreamContextAssembler {
  assemble(input: {
    workstream: AgentWorkstream;
    policy: WorkstreamRunPolicy;
    references: ManagedContextReference[];
    targetProfileId: string;
    hostEpoch: string;
  }): ManagedWorkstreamAssembledRequest {
    const unique = new Map<string, ManagedContextReference>();
    for (const reference of input.references) {
      if (
        reference.ownerUserId !== input.workstream.ownerUserId ||
        reference.projectId !== input.workstream.projectId ||
        reference.workstreamId !== input.workstream.id ||
        reference.workstreamRevision !== input.workstream.revision ||
        !/^[0-9a-f]{64}$/.test(reference.observedHash)
      ) {
        throw new Error('managed_workstream_reference_authority_invalid');
      }
      unique.set(reference.dependencyId, reference);
    }
    const references = [...unique.values()].sort((left, right) =>
      left.dependencyId.localeCompare(right.dependencyId),
    );
    const criteria = input.workstream.checkpoint.criteria
      .map((criterion) => `- ${criterion.id}: ${criterion.status}`)
      .join('\n');
    const referenceLines = references.length === 0
      ? '- none declared'
      : references.map((reference) => `- ${reference.canonicalId} @ ${reference.observedVersion} (${reference.sourceNamespace})`).join('\n');
    const prompt = [
      'You are a bounded Rhythm managed worker.',
      'This is a read-only inspection step. Do not edit files, run shell commands, use network tools, delegate, schedule work, send messages, or claim a criterion is complete without an authoritative receipt.',
      `Workstream ID: ${input.workstream.id}`,
      `Revision: ${input.workstream.revision}`,
      `Target profile: ${input.targetProfileId}`,
      `Host epoch: ${input.hostEpoch}`,
      `Authorized turn budget: 1; declared token ceiling: ${input.policy.maxTokens}; wall-time budget: ${input.policy.maxWallTimeSeconds}s. Actual usage may exceed an estimate and must be reported honestly.`,
      '',
      'Exact goal:', input.workstream.goal,
      '', 'Exact constraints:', input.workstream.constraints,
      '', 'Exact completion criteria:', input.workstream.criteria,
      '', 'Criterion state:', criteria || '- none declared',
      '', 'Declared reference identities only (not source content):', referenceLines,
      '', 'Next action:', `${input.workstream.checkpoint.nextAction.kind} / ${input.workstream.checkpoint.nextAction.scope}`,
      '', 'Return a concise inspection result with explicit uncertainty. Do not automatically continue after this turn.',
    ].join('\n');
    const estimatedAddedTokens = Math.ceil(Buffer.byteLength(prompt, 'utf8') / 4);
    if (estimatedAddedTokens > MANAGED_WORKSTREAM_MAX_ADDED_TOKENS) throw new ManagedWorkstreamPromptOverflow();
    return { prompt, references, estimatedAddedTokens };
  }
}
