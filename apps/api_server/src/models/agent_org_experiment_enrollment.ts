/**
 * C1 — a pre-run enrollment reservation, distinct from a `agent_run_outcomes`
 * ledger row.
 *
 * The ledger row is written at run FINALIZATION and is UPDATE/DELETE-blocked,
 * which is why W6 assigned cohorts there: a label absent from the INSERT could
 * never be added later. But finalization is also too late for C1/C2 — a run
 * whose treatment must be applied AT DISPATCH needs its cohort decided BEFORE
 * dispatch, not after the run already finished under whatever prompt it
 * happened to get. This record is that earlier commitment: reserved once per
 * run episode, before any prompt is sent, and read back (never re-decided) by
 * the terminal hook.
 */

export type ExperimentEnrollmentCohort = 'baseline' | 'candidate';

export type ExperimentEnrollmentFailureCode =
  | 'pre_dispatch_failed'
  | 'prompt_dispatch_failed'
  | 'provider_unavailable'
  | 'invalid_model'
  | 'prompt_timeout';

export const ENROLLMENT_FAILURE_CODES: ReadonlyArray<ExperimentEnrollmentFailureCode> = [
  'pre_dispatch_failed',
  'prompt_dispatch_failed',
  'provider_unavailable',
  'invalid_model',
  'prompt_timeout',
] as const;

export const ENROLLMENT_FAILURE_CODE_REASONS: Readonly<
  Record<ExperimentEnrollmentFailureCode, string>
> = {
  pre_dispatch_failed: 'pre_dispatch_failed',
  prompt_dispatch_failed: 'prompt_dispatch_failed',
  provider_unavailable: 'provider_unavailable',
  invalid_model: 'invalid_model',
  prompt_timeout: 'prompt_timeout',
} as const;

/**
 * Nonterminal by default (`reserved`). Active reservations are `reserved` and
 * `dispatched`; terminal rows are `treatment_failed` and `terminalized`.
 */
export type ExperimentEnrollmentState = 'reserved' | 'dispatched' | 'treatment_failed' | 'terminalized';

export interface ExperimentEnrollment {
  id: string;
  runEpisodeId: string;
  experimentId: string;
  proposalId: string;
  profileId: string;
  cohort: ExperimentEnrollmentCohort;
  assignmentDigest: string;
  baselineTargetRevisionHash: string;
  treatmentSpecHash: string;
  reservedAt: string;
  state: ExperimentEnrollmentState;
  failureCode: ExperimentEnrollmentFailureCode | null;
  failureReason: string | null;
}

export interface ReserveEnrollmentInput {
  id?: string;
  maxExposure: number;
  runEpisodeId: string;
  experimentId: string;
  proposalId: string;
  profileId: string;
  cohort: ExperimentEnrollmentCohort;
  assignmentDigest: string;
  baselineTargetRevisionHash: string;
  treatmentSpecHash: string;
}
