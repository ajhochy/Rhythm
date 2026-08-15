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

export const PROPOSAL_EVIDENCE_BUNDLE_VERSION = 'proposal-evidence-v1';

/**
 * The closed metric registry. A primary metric nothing can compute is not a
 * metric, so the bundle may only name one of these — each is a pure function
 * over a cohort of W4 ledger outcomes.
 */
export const PRIMARY_METRICS: Record<string, (cohort: AgentRunOutcome[]) => number> = {
  'objective-success-rate': (cohort) =>
    cohort.length === 0
      ? 0
      : cohort.filter((o) => o.objectiveVerdict === 'success').length / cohort.length,
  'terminal-error-rate': (cohort) =>
    cohort.length === 0
      ? 0
      : cohort.filter((o) => o.terminalStatus === 'error').length / cohort.length,
};

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
