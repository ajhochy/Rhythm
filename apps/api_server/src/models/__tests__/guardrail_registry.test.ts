/**
 * C3 — the closed, executable guardrail registry (contract
 * docs/ai/contracts/issue-causal-runtime-v2.json, phase C3).
 */

import { describe, expect, it } from 'vitest';

import {
  evaluateGuardrails,
  GUARDRAIL_NAMES,
  isKnownGuardrailName,
  type GuardrailContext,
} from '../guardrail_registry';
import type { AgentRunOutcome } from '../agent_run_outcome';
import type { ExperimentEnrollment } from '../agent_org_experiment_enrollment';

function outcome(terminalStatus: AgentRunOutcome['terminalStatus']): AgentRunOutcome {
  return {
    id: 'o',
    rootSessionId: 's',
    sessionId: null,
    runEpisodeId: null,
    scheduledOccurrenceId: null,
    experimentVariant: 'baseline',
    proposalId: 'p',
    profileId: null,
    configRevision: null,
    terminalStatus,
    objectiveVerdict: 'success',
    objectiveEvidence: { producedArtifact: true, errorCount: 0, approvalDenied: false },
    attribution: { v: 1, tools: [], skills: [], configRevision: 'unknown' },
    finalizedAt: '2026-08-19T00:00:00.000Z',
    createdAt: '2026-08-19T00:00:00.000Z',
  };
}

function enrollment(state: ExperimentEnrollment['state']): ExperimentEnrollment {
  return {
    id: 'e',
    runEpisodeId: 'r',
    experimentId: 'x',
    proposalId: 'p',
    profileId: 'prof',
    cohort: 'baseline',
    assignmentDigest: 'd',
    baselineTargetRevisionHash: `sha256:${'a'.repeat(64)}`,
    treatmentSpecHash: 'b'.repeat(64),
    reservedAt: '2026-08-19T00:00:00.000Z',
    state,
    failureCode: null,
    failureReason: null,
  };
}

describe('isKnownGuardrailName — the closed set', () => {
  it('admits exactly the two shipped guardrails', () => {
    expect(isKnownGuardrailName('terminal-error-rate')).toBe(true);
    expect(isKnownGuardrailName('treatment-integrity-failure-rate')).toBe(true);
    expect(GUARDRAIL_NAMES).toHaveLength(2);
  });

  it('rejects free text — a guardrail nothing can evaluate is not a guardrail', () => {
    expect(isKnownGuardrailName('revert if things look bad')).toBe(false);
    expect(isKnownGuardrailName('none')).toBe(false);
  });
});

describe('evaluateGuardrails', () => {
  it('terminal-error-rate breaches above 50% once the sample floor is met', () => {
    const ctx: GuardrailContext = {
      outcomes: [
        outcome('error'),
        outcome('error'),
        outcome('error'),
        outcome('completed'),
        outcome('completed'),
      ],
      enrollments: [],
      minSampleCount: 5,
    };
    const results = evaluateGuardrails(['terminal-error-rate'], ctx);
    expect(results).toHaveLength(1);
    expect(results[0].breached).toBe(true);
    expect(results[0].rate).toBeCloseTo(0.6);
  });

  it('never fires below the predeclared minimum sample count, however bad the rate looks', () => {
    const ctx: GuardrailContext = {
      outcomes: [outcome('error')],
      enrollments: [],
      minSampleCount: 5,
    };
    const results = evaluateGuardrails(['terminal-error-rate'], ctx);
    expect(results[0].breached).toBe(false);
  });

  it('treatment-integrity-failure-rate breaches above 30% of enrollment attempts', () => {
    const ctx: GuardrailContext = {
      outcomes: [],
      enrollments: [
        enrollment('treatment_failed'),
        enrollment('treatment_failed'),
        enrollment('reserved'),
        enrollment('reserved'),
        enrollment('dispatched'),
      ],
      minSampleCount: 5,
    };
    const results = evaluateGuardrails(['treatment-integrity-failure-rate'], ctx);
    expect(results[0].breached).toBe(true);
    expect(results[0].rate).toBeCloseTo(0.4);
  });

  it('silently ignores an unknown guardrail name rather than throwing (declaration-time validation is the real gate)', () => {
    const ctx: GuardrailContext = { outcomes: [], enrollments: [], minSampleCount: 1 };
    expect(evaluateGuardrails(['vibes-based-rollback'], ctx)).toEqual([]);
  });
});
