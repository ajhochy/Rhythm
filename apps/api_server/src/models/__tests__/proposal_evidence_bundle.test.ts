/**
 * C3 — treatment-bound outcomes, executable metrics, and guardrails
 * (docs/ai/contracts/issue-causal-runtime-v2.json, phase C3).
 *
 * These prove two of C3's required behaviors on the metric registry itself,
 * independent of the experiment service:
 *
 *  - A stored `success` verdict that directly CONTRADICTS its own evidence
 *    (an error/aborted terminal status, an explicit "no artifact produced",
 *    or a recorded error count) is unavailable for causal judgment — it is
 *    never counted as a success, though the row's presence still counts
 *    toward the cohort's sample size (the raw row is never altered/dropped).
 *  - `objective-success-rate` stays fail-closed for the ordinary case this
 *    protects against in production: a `completed` run whose evidence never
 *    resolved whether an artifact was produced is `inconclusive` at write
 *    time (finalizeVerdict), so it can never contribute to the numerator.
 */

import { describe, expect, it } from 'vitest';

import { finalizeVerdict } from '../../services/run_outcome_service';
import type { AgentRunOutcome } from '../agent_run_outcome';
import { KNOWN_METRIC_NAMES, PRIMARY_METRICS } from '../proposal_evidence_bundle';
import { EXPLICIT_USER_VERDICT_METRIC_NAME } from '../feedback_metric_adapter';

function outcome(overrides: Partial<AgentRunOutcome> = {}): AgentRunOutcome {
  return {
    id: 'out-1',
    rootSessionId: 'ses-1',
    sessionId: null,
    runEpisodeId: null,
    scheduledOccurrenceId: null,
    experimentVariant: 'baseline',
    proposalId: 'prop-1',
    profileId: null,
    configRevision: null,
    terminalStatus: 'completed',
    objectiveVerdict: 'success',
    objectiveEvidence: { producedArtifact: true, errorCount: 0, approvalDenied: false },
    attribution: { v: 1, tools: [], skills: [], configRevision: 'unknown' },
    finalizedAt: '2026-08-18T00:00:00.000Z',
    createdAt: '2026-08-18T00:00:00.000Z',
    ...overrides,
  };
}

describe('C3-2 objective-success-rate excludes internally inconsistent verdict/evidence pairs', () => {
  const objectiveSuccessRate = PRIMARY_METRICS['objective-success-rate'];

  it('never counts a stored success verdict whose terminalStatus is error', () => {
    // Bug this catches: a corrupted/legacy row (verdict='success',
    // terminalStatus='error') silently inflating a candidate's measured
    // success rate — the exact kind of proxy signal this campaign forbids.
    const cohort = [outcome({ terminalStatus: 'error', objectiveVerdict: 'success' })];
    expect(objectiveSuccessRate(cohort)).toBe(0);
  });

  it('never counts a stored success verdict whose evidence says no artifact was produced', () => {
    const cohort = [
      outcome({
        objectiveVerdict: 'success',
        objectiveEvidence: { producedArtifact: false, errorCount: 0, approvalDenied: false },
      }),
    ];
    expect(objectiveSuccessRate(cohort)).toBe(0);
  });

  it('never counts a stored success verdict whose evidence records a nonzero error count', () => {
    const cohort = [
      outcome({
        objectiveVerdict: 'success',
        objectiveEvidence: { producedArtifact: true, errorCount: 2, approvalDenied: false },
      }),
    ];
    expect(objectiveSuccessRate(cohort)).toBe(0);
  });

  it('preserves the row in the sample denominator — it is excluded from the numerator only', () => {
    // "Preserve the raw immutable row for audit but mark it unavailable for
    // causal judgment": the cohort's sample size must still be 2, not 1.
    const consistent = outcome({ rootSessionId: 'ses-consistent' });
    const contradictory = outcome({ rootSessionId: 'ses-bad', terminalStatus: 'error' });
    const rate = objectiveSuccessRate([consistent, contradictory]);
    expect(rate).toBe(0.5); // 1 of 2 — the contradictory row still counts toward the denominator
  });

  it('does NOT exclude an ordinary consistent success (no false positives)', () => {
    const cohort = [outcome()];
    expect(objectiveSuccessRate(cohort)).toBe(1);
  });
});

describe('C3-3 objective-success-rate stays fail-closed on unknown evidence', () => {
  it('finalizeVerdict never yields success for a completed run with unknown produced-artifact evidence', () => {
    // Regression guard: this is the WRITE-time invariant C3 must not weaken.
    // If this ever returns 'success', every completed run with unresolved
    // artifact evidence would inflate objective-success-rate permanently
    // (the ledger is insert-only/immutable).
    const verdict = finalizeVerdict('completed', {
      producedArtifact: null,
      errorCount: null,
      approvalDenied: null,
    });
    expect(verdict).toBe('inconclusive');
    expect(verdict).not.toBe('success');
  });

  it('so a cohort of such rows reports a ZERO objective-success-rate, never a phantom success', () => {
    const cohort = [
      outcome({
        objectiveVerdict: finalizeVerdict('completed', {
          producedArtifact: null,
          errorCount: null,
          approvalDenied: null,
        }),
        objectiveEvidence: { producedArtifact: null, errorCount: null, approvalDenied: null },
      }),
    ];
    expect(PRIMARY_METRICS['objective-success-rate'](cohort)).toBe(0);
  });
});

describe('C3-4 the closed metric name registry includes the feedback-backed metric', () => {
  it('KNOWN_METRIC_NAMES contains every PRIMARY_METRICS key plus explicit-user-verdict-rate', () => {
    for (const name of Object.keys(PRIMARY_METRICS)) {
      expect(KNOWN_METRIC_NAMES.has(name)).toBe(true);
    }
    expect(KNOWN_METRIC_NAMES.has(EXPLICIT_USER_VERDICT_METRIC_NAME)).toBe(true);
  });

  it('explicit-user-verdict-rate is NOT a PRIMARY_METRICS function — it needs the feedback stream, not just outcomes', () => {
    expect(Object.hasOwn(PRIMARY_METRICS, EXPLICIT_USER_VERDICT_METRIC_NAME)).toBe(false);
  });
});
