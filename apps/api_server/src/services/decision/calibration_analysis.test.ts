import { describe, expect, it } from 'vitest';

import {
  compareMarginToConfidence,
  confusionMatrix,
  describeMisroutes,
  envLineForThreshold,
  perTierAccuracy,
  recommendThreshold,
  routeDirection,
  scoreScaleDiagnostic,
  thresholdSweep,
  tokenOverlap,
  type CalibrationRow,
  type Tier,
} from './calibration_analysis';

function row(expected: Tier, picked: Tier, confidence: number, margin = 0.2, prompt = 'p'): CalibrationRow {
  const scores = { cheap: 0.1, standard: 0.1, frontier: 0.1 } as Record<Tier, number>;
  scores[picked] = confidence;
  return { prompt, expectedTier: expected, pickedTier: picked, confidence, margin, scores };
}

describe('threshold recommendation', () => {
  const rows = [
    row('cheap', 'cheap', 0.9), row('cheap', 'cheap', 0.8), row('standard', 'standard', 0.75),
    row('frontier', 'standard', 0.5), row('cheap', 'frontier', 0.4), row('standard', 'cheap', 0.35),
  ];
  it('picks the lowest threshold that reaches the accuracy target', () => {
    const rec = recommendThreshold(thresholdSweep(rows, 'confidence'), 0.9);
    expect(rec.threshold).toBe(0.55);
    expect(rec.row?.coverage).toBeCloseTo(0.5);
    expect(envLineForThreshold(rec.threshold as number)).toBe('AGENT_DECISION_ROUTING_MIN_CONFIDENCE=0.55');
  });
  it('reports none-qualifies and the best available row', () => {
    const bad = [row('cheap', 'frontier', 0.9), row('cheap', 'cheap', 0.8), row('standard', 'cheap', 0.7), row('cheap', 'cheap', 0.6)];
    const rec = recommendThreshold(thresholdSweep(bad, 'confidence'), 0.9);
    expect(rec.threshold).toBeNull();
    expect(rec.best).not.toBeNull();
  });
  it('prefers margin when only margin separates', () => {
    const rs = [
      row('cheap', 'cheap', 0.6, 0.5), row('cheap', 'cheap', 0.6, 0.45), row('standard', 'standard', 0.6, 0.4),
      row('frontier', 'cheap', 0.9, 0.05), row('frontier', 'standard', 0.9, 0.02),
    ];
    const cmp = compareMarginToConfidence(rs, 0.9);
    expect(cmp.confidence.threshold).toBeNull();
    expect(cmp.marginBetter).toBe(true);
  });
});

describe('matrix and direction', () => {
  const rows = [row('cheap', 'standard', 0.6), row('cheap', 'cheap', 0.6), row('frontier', 'standard', 0.5), row('frontier', 'cheap', 0.7), row('standard', 'standard', 0.8)];
  it('builds the confusion matrix and per-tier accuracy', () => {
    expect(confusionMatrix(rows).frontier).toEqual({ cheap: 1, standard: 1, frontier: 0 });
    expect(perTierAccuracy(rows).cheap.accuracy).toBeCloseTo(0.5);
  });
  it('counts over/under and recommends asymmetry when under dominates', () => {
    const d = routeDirection(rows);
    expect(d).toMatchObject({ correct: 2, over: 1, under: 2 });
    expect(d.recommendation).toMatch(/asymmetric/);
    expect(d.recommendation).toMatch(/0\.75/);
  });
  it('has no asymmetric advice when over-routing dominates', () => {
    const d = routeDirection([row('cheap', 'frontier', 0.6), row('cheap', 'standard', 0.6)]);
    expect(d.recommendation).not.toMatch(/asymmetric/);
  });
});

describe('score scale', () => {
  it('flags a narrow band', () => {
    const rs = [row('cheap', 'cheap', 0.52), row('cheap', 'cheap', 0.51)].map((r) => ({ ...r, scores: { cheap: 0.52, standard: 0.5, frontier: 0.49 } }));
    expect(scoreScaleDiagnostic(rs).recommendation).toMatch(/AGENT_DECISION_SCORE_SCALE=logit/);
  });
  it('flags out-of-range and passes healthy spreads', () => {
    expect(scoreScaleDiagnostic([row('cheap', 'cheap', 1.4)]).outOfRange).toBe(true);
    const ok = [row('cheap', 'cheap', 0.9)];
    expect(scoreScaleDiagnostic(ok).recommendation).toBeNull();
  });
});

describe('description overlap', () => {
  it('finds stem-level overlap', () => {
    expect(tokenOverlap('debug this flaky test', 'difficult debugging, multi-step planning')).toEqual(['debug']);
  });
  it('suggests a concrete fix for an over-matching tier', () => {
    const labels = [
      { id: 'cheap' as Tier, description: 'quick lookup' },
      { id: 'standard' as Tier, description: 'fix a routine bug' },
      { id: 'frontier' as Tier, description: 'difficult debugging and architecture' },
    ];
    const r = row('standard', 'frontier', 0.7, 0.3, 'debug the typo in the login form');
    const diag = describeMisroutes([r], labels);
    const f = diag.find((d) => d.tier === 'frontier')!;
    expect(f.overMatches).toHaveLength(1);
    expect(f.suggestions[0]).toMatch(/frontier description over-matches on 'debug'/);
    expect(diag.find((d) => d.tier === 'standard')!.suggestions[0]).toMatch(/standard description missed 1 prompt/);
  });
});
