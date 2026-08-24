/**
 * W1 corrective-6 package C — one classifier for an ambiguous scope pair.
 *
 * When an atomic target+proposal transaction throws, the caller cannot tell a
 * rolled-back attempt from a committed one, and the thrown text is never
 * evidence of which. The only honest answer comes from the durable rows:
 *
 *   preimage  — both rows are exactly as they were: it did NOT commit, so the
 *               operation is retryable and nothing should be terminalized.
 *   postimage — both rows are exactly what the transaction intended: it DID
 *               commit, and the caller may continue from there.
 *   unknown   — a mixed pair, a later operator revision, or rows that could
 *               not be read. Genuinely unknowable; must reconcile.
 *
 * This lives in its own module because the apply lane and the revert lane both
 * need it and previously had two hand-written copies. The copies drifted: one
 * grew a preimage arm the other lacked, which terminalized healthy rows on a
 * transient rollback. One implementation, both callers.
 */

import type { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import type { AgentOrgProposalsRepository } from '../repositories/agent_org_proposals_repository';

export type ScopeFieldName =
  | 'allowedMcpsJson'
  | 'allowedSkillsJson'
  | 'corePermissionsJson';

export type ScopePairClassification =
  | { kind: 'preimage' }
  | { kind: 'postimage'; proposalRevision: number; targetRevision: number }
  | { kind: 'unknown' };

export function readScopeFieldValue(
  config: Pick<
    { allowedMcpsJson: string | null; allowedSkillsJson: string | null; corePermissionsJson: string | null },
    ScopeFieldName
  >,
  field: ScopeFieldName,
): string | null {
  return field === 'allowedMcpsJson'
    ? config.allowedMcpsJson
    : field === 'allowedSkillsJson'
      ? config.allowedSkillsJson
      : config.corePermissionsJson;
}

/**
 * Both the status AND the exact bytes must match for a classification — a
 * concurrent operator write that happens to restore the bytes cannot move the
 * proposal status, and a committed transition cannot leave the source status,
 * so the conjunction is bound to the pair rather than to either row alone.
 */
export async function classifyAmbiguousScopePair(input: {
  proposalsRepo: AgentOrgProposalsRepository;
  configsRepo: AgentConfigsRepository;
  proposalId: string;
  targetId: string;
  field: ScopeFieldName;
  preimageStatus: string;
  preimageValue: string | null;
  postimageStatus: string;
  postimageValue: string | null;
}): Promise<ScopePairClassification> {
  try {
    const proposal = await input.proposalsRepo.findByIdAsync(input.proposalId);
    const target = input.configsRepo.getById(input.targetId);
    if (!proposal || !target) return { kind: 'unknown' };
    const value = readScopeFieldValue(target, input.field);
    if (proposal.status === input.preimageStatus && value === input.preimageValue) {
      return { kind: 'preimage' };
    }
    if (proposal.status === input.postimageStatus && value === input.postimageValue) {
      return {
        kind: 'postimage',
        proposalRevision: proposal.revision,
        targetRevision: target.revision,
      };
    }
    return { kind: 'unknown' };
  } catch {
    return { kind: 'unknown' };
  }
}
