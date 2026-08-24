/**
 * C6-3 — read-only, additive experiment/deployment summary for one proposal
 * (contract docs/ai/contracts/issue-causal-runtime-v2.json, phase C6).
 *
 * Deployment status (`proposal.status`) and causal outcome
 * (`proposal.outcomeStatus`) are already separate fields on the proposal
 * itself (W6-c8) — this module adds the remaining C6-3 summary facts on top:
 * collecting progress, eligible/missing counts, treatment integrity,
 * guardrail status, the experiment's terminal reason, tested baseline/
 * candidate spec fingerprints (sha256 — never the raw spec/prompt bytes),
 * and whether a verified candidate has drifted stale before it can be
 * applied. Nothing here mutates a proposal, an experiment, or any lifecycle
 * state — it only reads existing repositories.
 */
import { createHash } from 'node:crypto';

import type { RevisionedAgentOrgProposal } from '../models/agent_org_proposal';
import { evaluateGuardrails, type GuardrailName } from '../models/guardrail_registry';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { AgentOrgExperimentEnrollmentsRepository } from '../repositories/agent_org_experiment_enrollments_repository';
import { AgentOrgExperimentsRepository } from '../repositories/agent_org_experiments_repository';
import { AgentRunOutcomesRepository } from '../repositories/agent_run_outcomes_repository';
import { readAgentConfigField } from './org_proposal_apply';
import {
  extractConfigPatch,
  parseChange,
  verifyTestedTargetStillMatches,
} from './org_proposal_appliers_wiring';
import { computeCalibrationSnapshotAsync, type CalibrationSnapshotStatus } from './calibration_snapshot_service';
import { calibrationFamilyFromDurableEvidence } from './calibration_observation_service';

export type CollectingProgress = 'no_experiment' | 'collecting' | 'decided';
export type TreatmentIntegrityStatus = 'ok' | 'degraded' | 'unknown';
export type GuardrailSummaryStatus = 'ok' | 'breached' | 'unknown';

export interface ExperimentSummary {
  collectingProgress: CollectingProgress;
  eligibleCount: number;
  missingCount: number;
  treatmentIntegrity: TreatmentIntegrityStatus;
  guardrailStatus: GuardrailSummaryStatus;
  terminalReason: string | null;
  /** sha256 fingerprints only — never the raw spec/prompt bytes. */
  testedBaselineHash: string | null;
  testedCandidateHash: string | null;
  staleBeforeApplyConflict: boolean;
  calibrationStatus: CalibrationSnapshotStatus;
  calibratedConfidence: number | null;
}

const NO_EXPERIMENT_SUMMARY: ExperimentSummary = {
  collectingProgress: 'no_experiment',
  eligibleCount: 0,
  missingCount: 0,
  treatmentIntegrity: 'unknown',
  guardrailStatus: 'unknown',
  terminalReason: null,
  testedBaselineHash: null,
  testedCandidateHash: null,
  staleBeforeApplyConflict: false,
  calibrationStatus: 'uncalibrated',
  calibratedConfidence: null,
};

const SUMMARY_GUARDRAILS: readonly GuardrailName[] = [
  'terminal-error-rate',
  'treatment-integrity-failure-rate',
];

// ponytail: display-only sensitivity — the real enrollment-blocking guardrail
// gate has its own minSampleCount in org_proposal_experiment_service.ts. A
// summary should show "not enough data yet" (unknown) rather than a breach
// verdict on n=0, so 1 is enough here.
const MIN_SUMMARY_GUARDRAIL_SAMPLE = 1;

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Reuses the EXACT real apply-time drift check (org_proposal_appliers_wiring.
 * ts's verifyTestedTargetStillMatches) rather than a second implementation of
 * the same comparison, so a summary can never say "not stale" when the real
 * apply path would refuse.
 */
async function detectStaleBeforeApplyConflict(proposal: RevisionedAgentOrgProposal): Promise<boolean> {
  if (proposal.kind !== 'refine-config') return false;
  if (proposal.status !== 'proposed' && proposal.status !== 'approved' && proposal.status !== 'failed') {
    return false; // already applied/terminal — "before apply" no longer applies
  }
  const patch = extractConfigPatch(parseChange(proposal.changeJson));
  if (!patch) return false;
  const config = new AgentConfigsRepository().getById(patch.agentConfigId);
  if (!config) return true; // target vanished since the experiment ran
  const currentValue = readAgentConfigField(config, patch.field);
  const result = await verifyTestedTargetStillMatches(proposal, patch, currentValue);
  return !result.ok;
}

/** Builds the C6-3 summary for one proposal. Read-only. */
export async function buildExperimentSummaryAsync(
  proposal: RevisionedAgentOrgProposal,
): Promise<ExperimentSummary> {
  const experiments = await new AgentOrgExperimentsRepository().listByProposalAsync(proposal.id);
  if (experiments.length === 0) return NO_EXPERIMENT_SUMMARY;

  // listByProposalAsync orders ascending by declared_at — the last entry is
  // the most recently declared experiment for this proposal.
  const experiment = experiments[experiments.length - 1];

  const [enrollments, outcomes] = await Promise.all([
    new AgentOrgExperimentEnrollmentsRepository().listByExperimentAsync(experiment.id),
    new AgentRunOutcomesRepository().listReceiptBackedByExperimentAsync(experiment.id, proposal.id),
  ]);

  const eligibleCount = enrollments.filter((e) => e.state === 'terminalized').length;
  const missingCount = enrollments.filter((e) => e.state === 'treatment_failed').length;

  const guardrailEvaluations = evaluateGuardrails(SUMMARY_GUARDRAILS, {
    outcomes,
    enrollments,
    minSampleCount: MIN_SUMMARY_GUARDRAIL_SAMPLE,
  });
  const hasAnySample = enrollments.length > 0 || outcomes.length > 0;
  const anyBreached = guardrailEvaluations.some((g) => g.breached);
  const guardrailStatus: GuardrailSummaryStatus = !hasAnySample ? 'unknown' : anyBreached ? 'breached' : 'ok';

  const integrityEvaluation = guardrailEvaluations.find(
    (g) => g.guardrail === 'treatment-integrity-failure-rate',
  );
  const treatmentIntegrity: TreatmentIntegrityStatus =
    !integrityEvaluation || integrityEvaluation.sampleCount === 0
      ? 'unknown'
      : integrityEvaluation.breached
        ? 'degraded'
        : 'ok';

  const staleBeforeApplyConflict = await detectStaleBeforeApplyConflict(proposal);
  const family = calibrationFamilyFromDurableEvidence(proposal, experiment);
  const calibration = family
    ? await computeCalibrationSnapshotAsync(
        family,
        proposal.ownerUserId === null
          ? { kind: 'system-global' }
          : { kind: 'owner', ownerId: proposal.ownerUserId },
      )
    : null;

  return {
    collectingProgress: experiment.decision === null ? 'collecting' : 'decided',
    eligibleCount,
    missingCount,
    treatmentIntegrity,
    guardrailStatus,
    terminalReason: experiment.decision !== null ? experiment.decisionReason : null,
    testedBaselineHash: sha256Hex(experiment.baselineSpecJson),
    testedCandidateHash: sha256Hex(experiment.candidateSpecJson),
    staleBeforeApplyConflict,
    calibrationStatus: calibration?.status ?? 'uncalibrated',
    calibratedConfidence: calibration?.calibratedConfidence ?? null,
  };
}

/** Additive per-proposal enrichment for OrgProposalsController.list(). Read-only. */
export async function attachExperimentSummariesAsync<T extends RevisionedAgentOrgProposal>(
  proposals: T[],
): Promise<Array<T & { experimentSummary: ExperimentSummary }>> {
  return Promise.all(
    proposals.map(async (proposal) => ({
      ...proposal,
      experimentSummary: await buildExperimentSummaryAsync(proposal),
    })),
  );
}
