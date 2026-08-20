import type { AgentOrgExperiment } from '../models/agent_org_experiment';
import type { RevisionedAgentOrgProposal } from '../models/agent_org_proposal';
import { PROPOSAL_EVIDENCE_BUNDLE_V2_VERSION } from '../models/proposal_evidence_bundle';
import type { CalibrationObservationInput } from '../models/calibration_observation';
import { AgentOrgExperimentsRepository } from '../repositories/agent_org_experiments_repository';
import { AgentOrgProposalsRepository } from '../repositories/agent_org_proposals_repository';
import { CalibrationObservationsRepository } from '../repositories/calibration_observations_repository';
import { logger } from '../utils/logger';
import type { CalibrationFamilyKey } from './calibration_snapshot_service';
import { validateEvidenceBundle } from './proposal_evidence_validator';

function durableBundle(experiment: AgentOrgExperiment) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(experiment.evidenceBundleJson);
  } catch {
    return null;
  }
  const validation = validateEvidenceBundle(parsed);
  if (!validation.valid || validation.bundle.version !== PROPOSAL_EVIDENCE_BUNDLE_V2_VERSION) return null;
  return validation.bundle;
}

export function calibrationFamilyFromDurableEvidence(
  proposal: RevisionedAgentOrgProposal,
  experiment: AgentOrgExperiment,
): CalibrationFamilyKey | null {
  const bundle = durableBundle(experiment);
  if (
    !bundle?.detectorVersion ||
    bundle.treatmentVersion !== 'system-prompt-v1' ||
    !bundle.metricVersion
  ) return null;
  return {
    generatorVersion: bundle.generatorVersion,
    detectorVersion: bundle.detectorVersion,
    kind: proposal.kind,
    treatmentVersion: bundle.treatmentVersion,
    metricVersion: bundle.metricVersion,
  };
}

function observationBase(
  proposal: RevisionedAgentOrgProposal,
  experiment: AgentOrgExperiment,
): Omit<CalibrationObservationInput, 'sourceEventId' | 'observationType' | 'experimentDecision' | 'experimentEffect' | 'postDeployRegression'> | null {
  const bundle = durableBundle(experiment);
  const family = calibrationFamilyFromDurableEvidence(proposal, experiment);
  if (
    !family ||
    proposal.diagnosisConfidence === null ||
    !Number.isFinite(proposal.diagnosisConfidence) ||
    !proposal.diagnosisConfidenceVersion ||
    bundle?.initialConfidence !== proposal.diagnosisConfidence
  ) return null;
  return {
    scope: proposal.ownerUserId === null
      ? { kind: 'system-global' }
      : { kind: 'owner', ownerId: proposal.ownerUserId },
    proposalId: proposal.id,
    experimentId: experiment.id,
    ...family,
    initialConfidence: proposal.diagnosisConfidence,
    humanDecision: proposal.decidedByUserId === null ? null : proposal.status,
  };
}

export async function recordExperimentDecisionObservationAsync(
  experiment: AgentOrgExperiment,
): Promise<void> {
  if (!experiment.decision) return;
  try {
    const proposal = await new AgentOrgProposalsRepository().findByIdAsync(experiment.proposalId);
    if (!proposal) return;
    const base = observationBase(proposal, experiment);
    if (!base) return;
    await new CalibrationObservationsRepository().createAsync({
      ...base,
      sourceEventId: `experiment-decision:${experiment.id}`,
      observationType: 'experiment-decision',
      experimentDecision: experiment.decision,
      experimentEffect: Number.isFinite(experiment.results?.effect) ? experiment.results!.effect! : null,
      postDeployRegression: null,
    });
  } catch (error) {
    logger.warn(`[calibration] could not record experiment decision '${experiment.id}': ${String(error)}`);
  }
}

export async function recordPostDeployRegressionObservationAsync(
  proposalId: string,
  proposalRevision: number,
): Promise<void> {
  try {
    const proposal = await new AgentOrgProposalsRepository().findByIdAsync(proposalId);
    if (!proposal) return;
    const experiments = await new AgentOrgExperimentsRepository().listByProposalAsync(proposalId);
    const experiment = experiments.at(-1);
    if (!experiment?.decision) return;
    const base = observationBase(proposal, experiment);
    if (!base) return;
    await new CalibrationObservationsRepository().createAsync({
      ...base,
      sourceEventId: `post-deploy-regression:${proposalId}:${proposalRevision}`,
      observationType: 'post-deploy-regression',
      experimentDecision: null,
      experimentEffect: null,
      postDeployRegression: 1,
    });
  } catch (error) {
    logger.warn(`[calibration] could not record post-deploy regression '${proposalId}': ${String(error)}`);
  }
}
