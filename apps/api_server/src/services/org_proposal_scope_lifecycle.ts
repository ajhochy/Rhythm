/**
 * W1 corrective-6 package C — the human scope-approval lifecycle.
 *
 *   proposed|failed
 *     --exact human claim-->            approved      (target untouched)
 *     --atomic target + proposal CAS--> applied       (projection pending)
 *     --revision-fenced projection-->   measuring
 *
 * There is deliberately no durable `applying`: it would be an activity flag,
 * not ownership, and the proposal/target revision CAS pair already gives
 * one-winner semantics without adding another crash-stuck state.
 *
 * When projection cannot be proved, the ONLY safe moves are the exact atomic
 * inverse (applied -> approved, restoring the exact prior bytes) or, when even
 * that cannot be proved, reconciliation-required. Blind compensation would
 * overwrite whatever a concurrent operator wrote.
 */

import { logger } from '../utils/logger';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import {
  AgentOrgProposalsRepository,
  type ScopeProposalKind,
} from '../repositories/agent_org_proposals_repository';
import { projectLatestAgentProfile, type ProjectionOutcome } from './agent_profile_projection_service';
import { verifyScopeSnapshotForRevert } from './scope_mutation_contract';
import { parseStrictJson } from './strict_json';
import type { RevisionedAgentOrgProposal } from '../models/agent_org_proposal';
import type { PreparedScopePair } from './org_proposal_apply_service';

export type ScopeApplyOutcome =
  /** Pair committed, latest revision projected, proposal advanced to measuring. */
  | { kind: 'measuring'; proposal: RevisionedAgentOrgProposal }
  /** Nothing durable changed, or the exact inverse restored the prior bytes. */
  | { kind: 'conflict'; reason: string }
  /** Coherence could not be proved; a human must inspect the pair. */
  | { kind: 'reconciliation-required'; reason: string };

export interface ApplyApprovedScopeDeps {
  proposalsRepo?: AgentOrgProposalsRepository;
  configsRepo?: AgentConfigsRepository;
  project?: typeof projectLatestAgentProfile;
}

/**
 * The claim primitive's mandatory runtime verification: the stored snapshot
 * bytes must parse strictly, verify as a canonical v2 snapshot bound to this
 * exact kind and change, and name this exact target field.
 */
function boundSnapshotValidator(pair: PreparedScopePair) {
  return (material: {
    expectedKind: string;
    expectedChangeJson: string;
    beforeSnapshotJson: string;
  }): boolean => {
    let snapshot: unknown;
    try {
      snapshot = parseStrictJson(material.beforeSnapshotJson, 'proposal before_snapshot_json');
    } catch {
      return false;
    }
    const verified = verifyScopeSnapshotForRevert(
      snapshot,
      material.expectedKind,
      material.expectedChangeJson,
    );
    if (!verified) return false;
    return (
      verified.prepared.agentConfigId === pair.targetId &&
      verified.prepared.field === pair.field &&
      verified.prepared.priorValue === pair.priorValue &&
      verified.prepared.expectedAppliedValue === pair.nextValue
    );
  };
}

/**
 * An atomic transition that throws leaves the caller unable to tell a rolled
 * back attempt from a committed one, and the thrown text is never evidence of
 * which. Read BOTH rows back and classify by exact state: the preimage means
 * it did not commit, the postimage means it did, and anything else — a mixed
 * pair or a later operator revision — is genuinely unknowable and must stay
 * reconciliation-required.
 */
async function classifyAmbiguousTransition(input: {
  proposalsRepo: AgentOrgProposalsRepository;
  configsRepo: AgentConfigsRepository;
  proposalId: string;
  pair: PreparedScopePair;
  preimageStatus: string;
  preimageValue: string | null;
  postimageStatus: string;
  postimageValue: string | null;
}): Promise<
  | { kind: 'preimage' }
  | { kind: 'postimage'; proposalRevision: number; targetRevision: number }
  | { kind: 'unknown' }
> {
  try {
    const proposal = await input.proposalsRepo.findByIdAsync(input.proposalId);
    const target = input.configsRepo.getById(input.pair.targetId);
    if (!proposal || !target) return { kind: 'unknown' };
    const value = readScopeFieldValue(target, input.pair.field);
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

function readScopeFieldValue(
  config: { allowedMcpsJson: string | null; allowedSkillsJson: string | null; corePermissionsJson: string | null },
  field: PreparedScopePair['field'],
): string | null {
  return field === 'allowedMcpsJson'
    ? config.allowedMcpsJson
    : field === 'allowedSkillsJson'
      ? config.allowedSkillsJson
      : config.corePermissionsJson;
}

function describeProjection(outcome: ProjectionOutcome): string {
  return outcome.kind === 'stale'
    ? `stale (requested ${outcome.requestedRevision}, current ${outcome.currentRevision})`
    : outcome.kind;
}

/**
 * Runs the whole human scope route for one prepared proposal. Never mutates
 * the target before the durable `approved` claim wins, and never advances to
 * `measuring` before the exact applied revision is proved to be on disk.
 */
export async function applyApprovedScopeProposal(input: {
  proposal: RevisionedAgentOrgProposal;
  decidedByUserId: number;
  changeJson: string;
  beforeSnapshotJson: string;
  pair: PreparedScopePair;
  deps?: ApplyApprovedScopeDeps;
}): Promise<ScopeApplyOutcome> {
  const deps = input.deps ?? {};
  const proposalsRepo = deps.proposalsRepo ?? new AgentOrgProposalsRepository();
  const configsRepo = deps.configsRepo ?? new AgentConfigsRepository();
  const project = deps.project ?? projectLatestAgentProfile;
  const { proposal, pair } = input;

  // 1. Durable human claim. The target is still untouched at this point, so a
  //    loser sees a plain conflict with no half-applied state to reconcile.
  const approved = await proposalsRepo.claimScopeApprovedWithSnapshotAsync({
    id: proposal.id,
    decidedByUserId: input.decidedByUserId,
    expectedRevision: proposal.revision,
    expectedKind: proposal.kind as ScopeProposalKind,
    expectedChangeJson: input.changeJson,
    beforeSnapshotJson: input.beforeSnapshotJson,
    validateSnapshot: boundSnapshotValidator(pair),
  });
  if (!approved) {
    return { kind: 'conflict', reason: 'the proposal was already claimed or changed since preparation' };
  }

  // 2. One atomic transaction over BOTH rows. A miss changes neither, and the
  //    proposal is left at `approved` so recovery can inspect the exact claim.
  const target = configsRepo.getById(pair.targetId);
  if (!target) {
    return { kind: 'conflict', reason: `scope target ${pair.targetId} no longer exists` };
  }
  let applied;
  try {
    applied = await proposalsRepo.transitionScopeAtomicallyAtRevisionsAsync({
      proposalId: proposal.id,
      expectedProposalStatus: 'approved',
      nextProposalStatus: 'applied',
      expectedProposalRevision: approved.revision,
      expectedKind: proposal.kind as ScopeProposalKind,
      expectedChangeJson: input.changeJson,
      expectedBeforeSnapshotJson: input.beforeSnapshotJson,
      targetId: pair.targetId,
      expectedTargetRevision: target.revision,
      field: pair.field,
      expectedTargetValue: pair.priorValue,
      nextTargetValue: pair.nextValue,
      nextBaselineScore: proposal.baselineScore,
      nextPostScore: proposal.postScore,
      nextMeasureReason: proposal.measureReason,
    });
  } catch (error) {
    // The transaction either committed or it did not, and the thrown text is
    // not evidence of which. Classify from the durable rows instead.
    const classified = await classifyAmbiguousTransition({
      proposalsRepo, configsRepo, proposalId: proposal.id, pair,
      preimageStatus: 'approved', preimageValue: pair.priorValue,
      postimageStatus: 'applied', postimageValue: pair.nextValue,
    });
    if (classified.kind === 'preimage') {
      logger.warn(
        `[org-proposal-scope-lifecycle] atomic apply failed and rolled back for ` +
        `'${proposal.id}': ${String(error)}`,
      );
      return {
        kind: 'conflict',
        reason: 'the atomic apply transaction failed and neither row changed',
      };
    }
    if (classified.kind === 'unknown') {
      logger.warn(
        `[org-proposal-scope-lifecycle] atomic apply reported an ambiguous error for ` +
        `'${proposal.id}'; reconciliation required: ${String(error)}`,
      );
      return {
        kind: 'reconciliation-required',
        reason: 'the atomic apply transaction reported an indeterminate result',
      };
    }
    logger.warn(
      `[org-proposal-scope-lifecycle] atomic apply threw after a durable commit for ` +
      `'${proposal.id}': ${String(error)}`,
    );
    applied = {
      proposal: (await proposalsRepo.findByIdAsync(proposal.id))!,
      target: configsRepo.getById(pair.targetId)!,
    };
  }
  if (!applied) {
    return {
      kind: 'conflict',
      reason: `scope target ${pair.targetId}.${pair.field} changed after approval preparation`,
    };
  }

  // 3. Project by ID + committed revision. The boundary re-reads the latest
  //    row, so a concurrent operator edit is projected instead of our bytes.
  const projection = project({
    profileId: pair.targetId,
    expectedRevision: applied.target.revision,
    cause: 'scope-apply',
  });
  if (projection.kind === 'projected' || projection.kind === 'stale') {
    const measuring = await proposalsRepo.updateStatusAtRevisionAsync(
      proposal.id,
      applied.proposal.revision,
      'measuring',
    );
    if (!measuring) {
      return {
        kind: 'reconciliation-required',
        reason: 'the applied pair was projected but the measuring transition lost its revision CAS',
      };
    }
    return { kind: 'measuring', proposal: measuring };
  }

  // 4. Projection is not provable. Attempt the EXACT atomic inverse.
  let inverse;
  try {
    inverse = await proposalsRepo.transitionScopeAtomicallyAtRevisionsAsync({
      proposalId: proposal.id,
      expectedProposalStatus: 'applied',
      nextProposalStatus: 'approved',
      expectedProposalRevision: applied.proposal.revision,
      expectedKind: proposal.kind as ScopeProposalKind,
      expectedChangeJson: input.changeJson,
      expectedBeforeSnapshotJson: input.beforeSnapshotJson,
      targetId: pair.targetId,
      expectedTargetRevision: applied.target.revision,
      field: pair.field,
      expectedTargetValue: pair.nextValue,
      nextTargetValue: pair.priorValue,
      nextBaselineScore: proposal.baselineScore,
      nextPostScore: proposal.postScore,
      nextMeasureReason: proposal.measureReason,
    });
  } catch (error) {
    const classified = await classifyAmbiguousTransition({
      proposalsRepo, configsRepo, proposalId: proposal.id, pair,
      preimageStatus: 'applied', preimageValue: pair.nextValue,
      postimageStatus: 'approved', postimageValue: pair.priorValue,
    });
    logger.warn(
      `[org-proposal-scope-lifecycle] atomic inverse reported an ambiguous error for ` +
      `'${proposal.id}' (durable state: ${classified.kind}): ${String(error)}`,
    );
    if (classified.kind !== 'postimage') {
      return {
        kind: 'reconciliation-required',
        reason: 'the compensating transaction reported an indeterminate result',
      };
    }
    inverse = {
      proposal: (await proposalsRepo.findByIdAsync(proposal.id))!,
      target: configsRepo.getById(pair.targetId)!,
    };
  }
  if (!inverse) {
    // Someone else owns those bytes now. Restoring them blindly would destroy
    // a concurrent operator's write.
    logger.warn(
      `[org-proposal-scope-lifecycle] projection ${describeProjection(projection)} for ` +
      `'${proposal.id}' and the exact inverse lost its CAS; reconciliation required`,
    );
    return {
      kind: 'reconciliation-required',
      reason: `profile projection ${describeProjection(projection)} and the exact compensation ` +
        'lost a concurrent update, so the target bytes were preserved as found',
    };
  }

  const compensationProjection = project({
    profileId: pair.targetId,
    expectedRevision: inverse.target.revision,
    cause: 'scope-compensation',
  });
  if (compensationProjection.kind === 'blocked' || compensationProjection.kind === 'failed' ||
      compensationProjection.kind === 'missing') {
    return {
      kind: 'reconciliation-required',
      reason: `profile projection ${describeProjection(projection)}; the database pair was ` +
        `atomically restored but the compensating projection ` +
        `${describeProjection(compensationProjection)}`,
    };
  }
  return {
    kind: 'conflict',
    reason: `profile projection ${describeProjection(projection)}; the exact prior scope and the ` +
      'approved claim were atomically restored',
  };
}
