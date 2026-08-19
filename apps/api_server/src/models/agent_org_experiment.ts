/**
 * W6-c3 — one controlled experiment over a proposal.
 *
 * `decision` is the experiment's own verdict and is NOT a proposal status:
 * `inconclusive` is deliberately not a value agent_org_proposals.status can
 * ever hold, and ALLOWED_TRANSITIONS is not extended by this package. What a
 * decision may do to the proposal is set its additive `outcome_status`.
 */

export type ExperimentDecision = 'promote' | 'inconclusive' | 'regress';

export const EXPERIMENT_DECISIONS: readonly ExperimentDecision[] = [
  'promote',
  'inconclusive',
  'regress',
] as const;

/**
 * W6-c8 — outcome authority, kept strictly apart from deployment status.
 *
 * There are now two things an operator could call "inconclusive"; they do not
 * collide, and this is where that is written down:
 *
 *  - W5's reconciler COMPUTES an inconclusive verdict for a row STUCK in
 *    `measuring` past its budget, and deliberately persists nothing (writing it
 *    would bump the lifecycle revision for a read). Such a row never reached a
 *    keep, so its outcome_status is still `unproven` — W5's verdict is about
 *    the measurement being stuck, not about the change being unproven.
 *  - `outcome_status = 'inconclusive'` is DURABLE and is only ever written
 *    against a row that reached a terminal deployment state: it says the change
 *    shipped and nothing was proven about it.
 *
 * A row is therefore never both at once.
 */
export type ProposalOutcomeStatus = 'unproven' | 'inconclusive' | 'verified' | 'regressed';

export const PROPOSAL_OUTCOME_STATUSES: readonly ProposalOutcomeStatus[] = [
  'unproven',
  'inconclusive',
  'verified',
  'regressed',
] as const;

/** Per-cohort result. Both fields are required — an empty blob is not a result. */
export interface CohortResult {
  sampleCount: number;
  primaryMetricValue: number;
  /**
   * C3 — only populated for the `explicit-user-verdict-rate` metric: the
   * share of this cohort that had a resolved explicit-user verdict. A safe
   * NUMBER only, never the feedback text/reason itself.
   */
  responseRate?: number;
}

export interface ExperimentResults {
  baseline: CohortResult;
  candidate: CohortResult;
}

/**
 * Predeclared, immutable. `minSamplesPerCohort` is the floor below which no
 * decision other than inconclusive may be reached; `minEffect` is the
 * difference on the primary metric that counts as a real move in either
 * direction.
 */
export interface ExperimentStoppingRule {
  minSamplesPerCohort: number;
  minEffect: number;
}

export interface AgentOrgExperiment {
  id: string;
  proposalId: string;
  adapter: string;
  /** The exact validated evidence bundle bytes this experiment judges against. */
  evidenceBundleJson: string;
  baselineSpecJson: string;
  candidateSpecJson: string;
  assignmentKey: string;
  stoppingRule: ExperimentStoppingRule;
  maxExposure: number;
  results: ExperimentResults | null;
  decision: ExperimentDecision | null;
  decisionReason: string | null;
  declaredAt: string;
  resultsRecordedAt: string | null;
  decidedAt: string | null;
  createdAt: string;
}

export interface DeclareExperimentInput {
  id?: string;
  proposalId: string;
  adapter: string;
  evidenceBundleJson: string;
  baselineSpecJson: string;
  candidateSpecJson: string;
  assignmentKey: string;
  stoppingRule: ExperimentStoppingRule;
  maxExposure: number;
}

export function isExperimentResults(v: unknown): v is ExperimentResults {
  const cohortOk = (c: unknown): boolean =>
    typeof c === 'object' &&
    c !== null &&
    Number.isFinite((c as CohortResult).sampleCount) &&
    Number.isFinite((c as CohortResult).primaryMetricValue);
  return (
    typeof v === 'object' &&
    v !== null &&
    cohortOk((v as ExperimentResults).baseline) &&
    cohortOk((v as ExperimentResults).candidate)
  );
}
