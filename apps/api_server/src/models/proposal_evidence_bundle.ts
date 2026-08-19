/**
 * W6 — the versioned proposal evidence bundle (W6-c1) and the CLOSED experiment
 * adapter registry (W6-c13).
 *
 * The bundle is the reproducible evidence a candidate must carry before an
 * experiment may judge it. The version is part of the PERSISTED payload, not
 * implied by code shape, so an older bundle is recognisable as older and
 * refused rather than silently reinterpreted under today's rules — the same
 * failure class W1 hit with legacy whole-field snapshots.
 *
 * `guardrails` and `rollbackRule` are REQUIRED to be present and valid here,
 * and are stored verbatim. Enforcing them at runtime is deliberately not part
 * of W6 (see the contract's explicitly_out_of_scope list) — no W6 step
 * specifies it, and pretending otherwise would be the worse kind of lie.
 */

import type { AgentRunOutcome } from './agent_run_outcome';
import { EXPLICIT_USER_VERDICT_METRIC_NAME } from './feedback_metric_adapter';

export const PROPOSAL_EVIDENCE_BUNDLE_VERSION = 'proposal-evidence-v1';

/**
 * C3 — a stored `success` verdict that DIRECTLY contradicts its own recorded
 * evidence (an error/aborted terminal status, an explicit "no artifact
 * produced", or a nonzero recorded error count) is internally inconsistent
 * and unavailable for causal judgment. The raw immutable ledger row is
 * untouched — this only changes what `objective-success-rate` counts, never
 * what is stored — so the sample still counts toward `cohort.length` (the
 * audit trail/sample size is preserved) but never toward the numerator.
 *
 * Deliberately narrow: AMBIGUOUS/absent evidence (`producedArtifact: null`,
 * the ordinary shape for most of today's ledger rows) is NOT a contradiction
 * here — that fail-closed rule ("unknown produced artifact never yields
 * success") already lives at WRITE time in `finalizeVerdict`
 * (run_outcome_service.ts), which is what actually computes `objectiveVerdict`
 * for every real run. This check exists for the row a real finalizer could
 * never have produced in the first place (a corrupted write, a bypassed
 * finalizer, or a legacy/manual insert) — not to re-litigate every
 * evidence-light row the deterministic finalizer already handled correctly.
 */
function contradictsSuccessVerdict(outcome: AgentRunOutcome): boolean {
  if (outcome.terminalStatus === 'error' || outcome.terminalStatus === 'aborted') return true;
  if (outcome.objectiveEvidence.producedArtifact === false) return true;
  if (outcome.objectiveEvidence.errorCount !== null && outcome.objectiveEvidence.errorCount > 0) return true;
  return false;
}

/**
 * The closed metric registry. A primary metric nothing can compute is not a
 * metric, so the bundle may only name one of these — each is a pure function
 * over a cohort of W4 ledger outcomes.
 */
export const PRIMARY_METRICS: Record<string, (cohort: AgentRunOutcome[]) => number> = {
  'objective-success-rate': (cohort) => {
    if (cohort.length === 0) return 0;
    const consistentSuccesses = cohort.filter(
      (o) => o.objectiveVerdict === 'success' && !contradictsSuccessVerdict(o),
    ).length;
    return consistentSuccesses / cohort.length;
  },
  'terminal-error-rate': (cohort) =>
    cohort.length === 0
      ? 0
      : cohort.filter((o) => o.terminalStatus === 'error').length / cohort.length,
};

/**
 * C3 — the closed set of metric NAMES a bundle's `primaryMetric.name` may
 * hold. `PRIMARY_METRICS` alone is no longer the full picture:
 * `explicit-user-verdict-rate` (feedback_metric_adapter.ts) reads the
 * append-only feedback stream, not `AgentRunOutcome[]`, so it cannot be a
 * `(cohort: AgentRunOutcome[]) => number` function and is never added to
 * `PRIMARY_METRICS` itself — but it is still a real, closed, predeclared
 * metric a bundle may name.
 */
export const KNOWN_METRIC_NAMES: ReadonlySet<string> = new Set([
  ...Object.keys(PRIMARY_METRICS),
  EXPLICIT_USER_VERDICT_METRIC_NAME,
]);

export interface ExperimentAdapter {
  name: string;
  /**
   * Whether evidence gathered through this adapter can establish VERIFIED
   * improvement. W6-c6's six named proxies are all `false`: one replay, one
   * usage count, a shorter allowlist, output length, the disappearance of a
   * regex, and one LLM score are each individually insufficient for promotion.
   */
  canEstablishVerified: boolean;
  /** Why, in one line, an operator reading a refusal reason. */
  note: string;
}

function adapter(name: string, canEstablishVerified: boolean, note: string): ExperimentAdapter {
  return { name, canEstablishVerified, note };
}

/**
 * W6-c13 — the CLOSED, code-defined registry. `unsupported adapter` in W6-c2
 * only has meaning against a closed set; an unknown name is rejected outright.
 */
export const EXPERIMENT_ADAPTERS: Record<string, ExperimentAdapter> = {
  'paired-cohort-outcome': adapter(
    'paired-cohort-outcome',
    true,
    'paired baseline/candidate cohorts from the W4 run-outcome ledger',
  ),
  'single-replay': adapter('single-replay', false, 'one replay is not evidence of improvement'),
  'usage-count': adapter('usage-count', false, 'one usage count is not evidence of improvement'),
  'allowlist-shrink': adapter(
    'allowlist-shrink',
    false,
    'a shorter allowlist is tidiness, not measured improvement',
  ),
  'output-length': adapter('output-length', false, 'output length is not a quality measure'),
  'regex-disappearance': adapter(
    'regex-disappearance',
    false,
    'the disappearance of a regex is not evidence of improvement',
  ),
  'llm-body-score': adapter(
    'llm-body-score',
    false,
    'one LLM score is a proxy, never verified improvement',
  ),
};

export interface EvidenceSourceRefs {
  sessionIds: string[];
  eventIds: string[];
}

export interface CounterEvidenceSearch {
  query: string;
  searchedAt: string;
  contradictingCount: number;
}

export interface EvidenceTargetRef {
  ref: string;
  hash: string;
}

export interface PrimaryMetricSpec {
  name: string;
  direction: 'increase' | 'decrease';
  /**
   * C3 — REQUIRED only when `name === 'explicit-user-verdict-rate'`: the
   * predeclared minimum share of a cohort that must have responded before
   * the metric is available at all (see feedback_metric_adapter.ts). Ignored
   * for objective metrics, which never go silent.
   */
  minResponseCoverage?: number;
}

export interface ProposalEvidenceBundle {
  version: string;
  sourceEvidence: EvidenceSourceRefs;
  counterEvidenceSearch: CounterEvidenceSearch;
  target: EvidenceTargetRef;
  expectedOutcome: string;
  primaryMetric: PrimaryMetricSpec;
  guardrails: string[];
  experimentAdapter: string;
  rollbackRule: string;
  generatorVersion: string;
  confidenceCalibrationVersion: string;
}
