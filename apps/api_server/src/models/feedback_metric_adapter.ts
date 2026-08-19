/**
 * C3 — the explicit-user-verdict-rate metric adapter (contract
 * docs/ai/contracts/issue-causal-runtime-v2.json, phase C3).
 *
 * Distinct from `PRIMARY_METRICS` (proposal_evidence_bundle.ts): those are
 * pure functions over OBJECTIVE ledger outcomes only. This metric reads the
 * append-only, user-authored feedback stream instead (W4's
 * `agent_run_feedback_events`), so it needs a different input shape (one
 * resolved verdict — or none — per cohort member) and a different failure
 * mode: silence. A run nobody rated is not a bad run, but it is also not
 * evidence, and a metric that treats "no response" as a zero (or drops it
 * from the denominator without saying so) can be gamed by whichever arm
 * gets fewer responses. This adapter refuses to average over responses at
 * all until a PREDECLARED minimum share of the cohort has responded, and
 * reports the raw response rate so a caller can refuse promotion on an
 * imbalance between arms (see decideExperiment in
 * org_proposal_experiment_service.ts).
 *
 * Scoring is CLOSED and immutable — not something a bundle can redeclare —
 * exactly like EXPERIMENT_ADAPTERS/GUARDRAIL_REGISTRY: partial=0.5,
 * success=1, failure=0.
 */

import type { UserVerdict } from './agent_run_outcome';

export const EXPLICIT_USER_VERDICT_METRIC_NAME = 'explicit-user-verdict-rate' as const;

/** Closed, predeclared scoring — never per-bundle configurable. */
export const EXPLICIT_USER_VERDICT_SCORE: Readonly<Record<UserVerdict, number>> = {
  success: 1,
  partial: 0.5,
  failure: 0,
};

export interface FeedbackMetricCohortResult {
  /** null when responseRate is below the predeclared minimum coverage — unavailable, never guessed or zeroed. */
  value: number | null;
  responseCount: number;
  totalCount: number;
  responseRate: number;
}

/**
 * `responses` has exactly one entry per cohort member: that member's latest
 * explicit-user verdict, or `null` if nobody responded for that run.
 */
export function computeExplicitUserVerdictRate(
  responses: ReadonlyArray<UserVerdict | null>,
  minResponseCoverage: number,
): FeedbackMetricCohortResult {
  const totalCount = responses.length;
  const responded = responses.filter((r): r is UserVerdict => r !== null);
  const responseCount = responded.length;
  const responseRate = totalCount === 0 ? 0 : responseCount / totalCount;
  if (responseRate < minResponseCoverage || responseCount === 0) {
    return { value: null, responseCount, totalCount, responseRate };
  }
  const sum = responded.reduce((acc, v) => acc + EXPLICIT_USER_VERDICT_SCORE[v], 0);
  return { value: sum / responseCount, responseCount, totalCount, responseRate };
}
