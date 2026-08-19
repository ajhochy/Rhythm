/**
 * W4 — immutable run-outcome and append-only feedback ledger.
 *
 * Two records, deliberately separate:
 *
 *  - `AgentRunOutcome` is the OBJECTIVE record. Exactly one per root run,
 *    written once at finalization and immutable from that moment (the schema
 *    enforces both — see migrations.ts).
 *  - `AgentRunFeedbackEvent` is the SUBJECTIVE record: append-only rows, each
 *    tagged with its `source` and `confidence`. Explicit user feedback and
 *    inferred feedback are different sources of the same append-only stream,
 *    never two writers competing for one column.
 *
 * That split is what makes W4-c5 and W4-c11 hold at the same time: a later
 * human verdict cannot rewrite the finalized objective row, and an inferred
 * verdict cannot overwrite an explicit one, because nothing is ever
 * overwritten at all.
 */

/** The four outcomes the deterministic finalizer may produce. */
export type RunVerdict = 'success' | 'partial' | 'failure' | 'inconclusive';

/** The three verdicts a human may report through the feedback API. */
export type UserVerdict = Extract<RunVerdict, 'success' | 'partial' | 'failure'>;

export const USER_VERDICTS: readonly UserVerdict[] = [
  'success',
  'partial',
  'failure',
] as const;

/** How a run ended, as observed by the terminal hook. */
export type TerminalStatus = 'completed' | 'error' | 'aborted' | 'unknown';

/**
 * Objective, countable evidence. `null` means "not observable for this run" and
 * is never coerced to a default — the finalizer treats it as absent evidence
 * and declines to decide, which is the whole point of W4-c6.
 */
export interface ObjectiveEvidence {
  producedArtifact: boolean | null;
  errorCount: number | null;
  approvalDenied: boolean | null;
}

/** Explicit unknown marker. Never omitted, never guessed. */
export const UNKNOWN_REVISION = 'unknown';

export interface AttributedRevision {
  name: string;
  revision: string | typeof UNKNOWN_REVISION;
}

export interface RunAttribution {
  v: 1;
  tools: AttributedRevision[];
  skills: AttributedRevision[];
  configRevision: number | typeof UNKNOWN_REVISION;
}

export type FeedbackSource = 'explicit_user' | 'inferred';

export interface AgentRunOutcome {
  id: string;
  rootSessionId: string;
  sessionId: string | null;
  /**
   * C2-D (S2) — the run episode this outcome belongs to. `null` for any
   * outcome finalized before this column existed. Joined against
   * `agent_org_experiment_treatment_receipts.run_episode_id` to read only
   * receipt-proved (actually treated) runs — see
   * AgentRunOutcomesRepository.listReceiptBackedByExperimentAsync.
   */
  runEpisodeId: string | null;
  scheduledOccurrenceId: string | null;
  experimentVariant: string | null;
  proposalId: string | null;
  profileId: string | null;
  configRevision: number | null;
  terminalStatus: TerminalStatus;
  objectiveVerdict: RunVerdict;
  objectiveEvidence: ObjectiveEvidence;
  attribution: RunAttribution;
  finalizedAt: string;
  createdAt: string;
}

export interface AgentRunFeedbackEvent {
  id: string;
  rootSessionId: string;
  source: FeedbackSource;
  verdict: UserVerdict;
  confidence: number;
  actor: string | null;
  reason: string | null;
  createdAt: string;
}

/**
 * The read model W4-c4 asks for: objective, explicit-user and inferred verdicts
 * as three distinct fields, so reading one can never be mistaken for another.
 * `authoritativeVerdict` resolves the precedence in one place — an explicit
 * human verdict outranks every inference, forever.
 */
export interface AgentRunOutcomeView {
  outcome: AgentRunOutcome;
  objectiveVerdict: RunVerdict;
  explicitUserVerdict: UserVerdict | null;
  inferredVerdict: UserVerdict | null;
  authoritativeVerdict: RunVerdict;
  feedback: AgentRunFeedbackEvent[];
}
