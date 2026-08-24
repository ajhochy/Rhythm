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
 * C5 — the deterministic-evidence-builder version (contract
 * docs/ai/contracts/issue-causal-runtime-v2.json, phase C5, requirement 3).
 * An ADDITION to `proposal-evidence-v1`, not a replacement: an operator may
 * still hand-declare a v1 bundle (proposal_evidence_validator.ts validates
 * both), but only a v2 bundle may carry `counterEvidenceSearch.method` +
 * `.coverage` — the typed, coverage-recorded counter-evidence search a
 * builder (never a human) can actually perform deterministically.
 */
export const PROPOSAL_EVIDENCE_BUNDLE_V2_VERSION = 'proposal-evidence-v2';

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

/**
 * C5 — the closed set of counter-evidence search methods a
 * `proposal-evidence-v2` bundle's search may declare. "Typed" means this,
 * not a free-text query a human could type: an unrecognised method is a
 * validation failure, same posture as EXPERIMENT_ADAPTERS/GUARDRAIL_NAMES.
 */
export type CounterEvidenceSearchMethod = 'same-profile-ledger-scan';

export const COUNTER_EVIDENCE_SEARCH_METHODS: readonly CounterEvidenceSearchMethod[] = [
  'same-profile-ledger-scan',
] as const;

export function isKnownCounterEvidenceSearchMethod(v: unknown): v is CounterEvidenceSearchMethod {
  return (COUNTER_EVIDENCE_SEARCH_METHODS as readonly unknown[]).includes(v);
}

export interface CounterEvidenceSearch {
  query: string;
  searchedAt: string;
  contradictingCount: number;
  /**
   * REQUIRED only on `proposal-evidence-v2` bundles — see
   * {@link CounterEvidenceSearchMethod}. Absent on v1 (operator hand-typed
   * free-text query, no typed method to name).
   */
  method?: CounterEvidenceSearchMethod;
  /**
   * REQUIRED only on `proposal-evidence-v2` bundles — the fraction [0,1] of
   * the qualifying fact population the search actually scanned. Records
   * INCOMPLETE coverage rather than hiding it: a builder that could not scan
   * the whole population must say so, not report a search that looks total.
   */
  coverage?: number;
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
  /**
   * C6 (repair item 3) — REQUIRED on `proposal-evidence-v2` bundles only
   * (validated by proposal_evidence_validator.ts); absent on v1. A truthful,
   * never-fabricated [0,1] confidence: the deterministic evidence builder
   * (proposal_evidence_builder.ts) populates it ONLY from a proposal's
   * durable `diagnosisConfidence` (mapped once, at proposal creation, from
   * the generator's own high/medium/low verdict — see
   * DIAGNOSIS_CONFIDENCE_MAPPING_VERSION). When that durable field is
   * absent, the builder fails closed (the proposal stays human-only) rather
   * than inventing a number.
   */
  initialConfidence?: number;
  /** C6 (repair item 3) — REQUIRED on v2 bundles: the versioned qualifying-failure detector that selected the evidence. */
  detectorVersion?: string;
  /** C6 (repair item 3) — REQUIRED on v2 bundles: the versioned treatment adapter (e.g. `system-prompt-v1`). */
  treatmentVersion?: string;
  /** C6 (repair item 3) — REQUIRED on v2 bundles: the versioned primary metric (e.g. `objective-success-rate-v1`). */
  metricVersion?: string;
}
