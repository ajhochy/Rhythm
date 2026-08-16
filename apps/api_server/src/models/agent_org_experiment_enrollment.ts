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
 * Nonterminal by default (`reserved`). `treatment_failed` is the only
 * terminal state this phase writes, and only on a dispatch failure — see
 * required_behavior for C1. Other terminal states arrive with C2/C3.
 */
export type ExperimentEnrollmentState = 'reserved' | 'treatment_failed';

export interface ExperimentEnrollment {
  id: string;
  runEpisodeId: string;
  experimentId: string;
  proposalId: string;
  profileId: string;
  cohort: ExperimentEnrollmentCohort;
  assignmentDigest: string;
  reservedAt: string;
  state: ExperimentEnrollmentState;
}

export interface ReserveEnrollmentInput {
  id?: string;
  runEpisodeId: string;
  experimentId: string;
  proposalId: string;
  profileId: string;
  cohort: ExperimentEnrollmentCohort;
  assignmentDigest: string;
}
