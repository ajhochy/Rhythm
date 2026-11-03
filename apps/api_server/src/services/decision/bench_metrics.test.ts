import { describe, expect, it } from 'vitest';

import {
  ece,
  mean,
  mrr,
  ndcg,
  percentile,
  precisionRecallAtThreshold,
  recallAtK,
  reciprocalRank,
} from './bench_metrics';

describe('percentile', () => {
  it('interpolates and handles edges', () => {
    expect(percentile([], 50)).toBe(0);
    expect(percentile([7], 95)).toBe(7);
    expect(percentile([1, 2, 3, 4], 50)).toBeCloseTo(2.5, 6);
    expect(percentile([4, 1, 3, 2], 100)).toBe(4);
    expect(percentile([1, 2, 3, 4, 5], 0)).toBe(1);
    expect(percentile([10, 20], 95)).toBeCloseTo(19.5, 6);
  });
});

describe('ece', () => {
  it('is 0 for a perfectly calibrated set', () => {
    const samples = [
      ...Array.from({ length: 10 }, (_, i) => ({ confidence: 0.9, correct: i < 9 })),
      ...Array.from({ length: 10 }, (_, i) => ({ confidence: 0.1, correct: i < 1 })),
    ];
    expect(ece(samples).ece).toBeCloseTo(0, 6);
  });

  it('measures over-confidence and bins confidence 1.0 in the last bin', () => {
    const samples = Array.from({ length: 4 }, (_, i) => ({ confidence: 1, correct: i === 0 }));
    const r = ece(samples, 5);
    expect(r.ece).toBeCloseTo(0.75, 6);
    expect(r.bins).toHaveLength(5);
    expect(r.bins[4]).toMatchObject({ n: 4, accuracy: 0.25 });
    expect(r.bins[0].n).toBe(0);
  });

  it('weights bins by population and handles empty input', () => {
    const r = ece([
      { confidence: 0.5, correct: true },
      { confidence: 0.5, correct: false },
      { confidence: 0.95, correct: false },
      { confidence: 0.95, correct: false },
    ]);
    // bin 2: |0.5-0.5|*0.5 ; bin 4: |0-0.95|*0.5
    expect(r.ece).toBeCloseTo(0.475, 6);
    expect(ece([]).ece).toBe(0);
  });
});

describe('ndcg / mrr / recall', () => {
  it('ndcg is 1 for ideal order, lower otherwise, 0 with no relevant', () => {
    expect(ndcg([1, 1, 0, 0], 3)).toBeCloseTo(1, 6);
    const worse = ndcg([0, 1, 0, 1], 3);
    expect(worse).toBeGreaterThan(0);
    expect(worse).toBeLessThan(1);
    // ideal for 2 relevant = 1 + 1/log2(3); actual = 1/log2(3)
    expect(worse).toBeCloseTo((1 / Math.log2(3)) / (1 + 1 / Math.log2(3)), 6);
    expect(ndcg([0, 0, 0], 3)).toBe(0);
  });

  it('reciprocal rank and MRR', () => {
    expect(reciprocalRank([false, false, true])).toBeCloseTo(1 / 3, 6);
    expect(reciprocalRank([false, false])).toBe(0);
    expect(mrr([[true], [false, true]])).toBeCloseTo(0.75, 6);
  });

  it('recall@k', () => {
    expect(recallAtK([true, false, true, true], 3)).toBeCloseTo(2 / 3, 6);
    expect(recallAtK([false, false], 3)).toBe(0);
    expect(recallAtK([true], 1, 2)).toBe(0.5);
  });
});

describe('precisionRecallAtThreshold', () => {
  it('computes precision/recall over selected items', () => {
    const items = [
      { score: 0.9, relevant: true },
      { score: 0.6, relevant: false },
      { score: 0.4, relevant: true },
      { score: 0.1, relevant: false },
    ];
    expect(precisionRecallAtThreshold(items, 0.5)).toEqual({ precision: 0.5, recall: 0.5, selected: 2 });
    expect(precisionRecallAtThreshold(items, 0.95)).toEqual({ precision: 0, recall: 0, selected: 0 });
  });
});

describe('mean', () => {
  it('handles empty', () => {
    expect(mean([])).toBe(0);
    expect(mean([1, 2, 3])).toBe(2);
  });
});
