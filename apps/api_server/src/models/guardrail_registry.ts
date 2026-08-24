/**
 * C3 — the closed, executable guardrail registry (contract
 * docs/ai/contracts/issue-causal-runtime-v2.json, phase C3).
 *
 * W6 declared `guardrails: string[]` on the evidence bundle but never
 * executed them — any free text passed the validator ("must list at least
 * one guardrail") and nothing ever checked it against real data. A guardrail
 * that cannot fire is not a safety mechanism, it is documentation.
 *
 * This registry closes that gap: a declared guardrail must be one of the
 * names below, and each name maps to a real, deterministic predicate over
 * receipt-backed outcomes / enrollment state. An unknown name makes
 * declaration invalid (see proposal_evidence_validator.ts); a breached
 * guardrail stops new enrollment (see reserveRunEnrollment in
 * org_proposal_experiment_service.ts).
 *
 * ponytail: thresholds are fixed constants, not per-bundle configurable —
 * upgrade to a declared numeric bound on the bundle if a real proposal ever
 * needs a different ceiling than the one below.
 */

import type { AgentRunOutcome } from './agent_run_outcome';
import type { ExperimentEnrollment } from './agent_org_experiment_enrollment';

export type GuardrailName = 'terminal-error-rate' | 'treatment-integrity-failure-rate';

export const GUARDRAIL_NAMES: readonly GuardrailName[] = [
  'terminal-error-rate',
  'treatment-integrity-failure-rate',
] as const;

export function isKnownGuardrailName(name: string): name is GuardrailName {
  return (GUARDRAIL_NAMES as readonly string[]).includes(name);
}

/** What a guardrail predicate needs to decide whether it has breached. */
export interface GuardrailContext {
  /** Receipt-backed outcomes for the experiment, both cohorts combined. */
  outcomes: AgentRunOutcome[];
  /** Every enrollment row (any state) reserved for the experiment. */
  enrollments: ExperimentEnrollment[];
  /** Below this many samples a guardrail never fires — avoids tripping on n=1. */
  minSampleCount: number;
}

export interface GuardrailBreachCheck {
  breached: boolean;
  rate: number;
  sampleCount: number;
}

const TERMINAL_ERROR_RATE_MAX = 0.5;
const TREATMENT_INTEGRITY_FAILURE_RATE_MAX = 0.3;

function checkTerminalErrorRate(ctx: GuardrailContext): GuardrailBreachCheck {
  const sampleCount = ctx.outcomes.length;
  if (sampleCount < ctx.minSampleCount) return { breached: false, rate: 0, sampleCount };
  const errors = ctx.outcomes.filter((o) => o.terminalStatus === 'error').length;
  const rate = errors / sampleCount;
  return { breached: rate > TERMINAL_ERROR_RATE_MAX, rate, sampleCount };
}

function checkTreatmentIntegrityFailureRate(ctx: GuardrailContext): GuardrailBreachCheck {
  const sampleCount = ctx.enrollments.length;
  if (sampleCount < ctx.minSampleCount) return { breached: false, rate: 0, sampleCount };
  const failed = ctx.enrollments.filter((e) => e.state === 'treatment_failed').length;
  const rate = failed / sampleCount;
  return { breached: rate > TREATMENT_INTEGRITY_FAILURE_RATE_MAX, rate, sampleCount };
}

export const GUARDRAIL_REGISTRY: Readonly<
  Record<GuardrailName, (ctx: GuardrailContext) => GuardrailBreachCheck>
> = {
  'terminal-error-rate': checkTerminalErrorRate,
  'treatment-integrity-failure-rate': checkTreatmentIntegrityFailureRate,
};

export interface GuardrailEvaluation {
  guardrail: GuardrailName;
  breached: boolean;
  rate: number;
  sampleCount: number;
}

/**
 * Evaluate every DECLARED guardrail that is actually in the closed registry
 * (an unknown name should never reach here — it makes declaration invalid —
 * but this stays defensive rather than throwing on stale/corrupted data).
 * Returns every evaluation, breached or not, so a caller can report/log the
 * near-miss guardrails too, not just the one that fired.
 */
export function evaluateGuardrails(
  guardrails: readonly string[],
  ctx: GuardrailContext,
): GuardrailEvaluation[] {
  return guardrails.filter(isKnownGuardrailName).map((name) => ({
    guardrail: name,
    ...GUARDRAIL_REGISTRY[name](ctx),
  }));
}
