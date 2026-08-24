/**
 * C3 — the explicit-user-verdict-rate metric adapter (contract
 * docs/ai/contracts/issue-causal-runtime-v2.json, phase C3).
 */

import { describe, expect, it } from 'vitest';

import { computeExplicitUserVerdictRate } from '../feedback_metric_adapter';

describe('computeExplicitUserVerdictRate', () => {
  it('scores success=1, partial=0.5, failure=0 over responders only', () => {
    const result = computeExplicitUserVerdictRate(['success', 'partial', 'failure', 'success'], 0);
    // (1 + 0.5 + 0 + 1) / 4 = 0.625
    expect(result.value).toBeCloseTo(0.625);
    expect(result.responseCount).toBe(4);
    expect(result.totalCount).toBe(4);
    expect(result.responseRate).toBe(1);
  });

  it('is unavailable (null), never zero, below the predeclared minimum coverage', () => {
    const result = computeExplicitUserVerdictRate(['success', null, null, null], 0.5);
    expect(result.responseRate).toBe(0.25);
    expect(result.value).toBeNull();
  });

  it('is available once coverage meets the predeclared minimum exactly', () => {
    const result = computeExplicitUserVerdictRate(['success', 'failure', null, null], 0.5);
    expect(result.responseRate).toBe(0.5);
    expect(result.value).toBeCloseTo(0.5); // (1 + 0) / 2
  });

  it('is unavailable for a cohort with no responses at all, never a fabricated zero', () => {
    const result = computeExplicitUserVerdictRate([null, null, null], 0);
    expect(result.value).toBeNull();
    expect(result.responseCount).toBe(0);
  });

  it('handles an empty cohort without dividing by zero', () => {
    const result = computeExplicitUserVerdictRate([], 0);
    expect(result.value).toBeNull();
    expect(result.responseRate).toBe(0);
  });
});
