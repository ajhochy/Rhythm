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
