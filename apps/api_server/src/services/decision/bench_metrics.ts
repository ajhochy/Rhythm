/** Pure metric helpers for the decision bench (no I/O, no engine imports). */

export function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

/** Linear-interpolated percentile, p in [0,100]. Empty input gives 0. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const clamped = Math.min(100, Math.max(0, p));
  const pos = (clamped / 100) * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export interface CalibrationSample {
  confidence: number;
  correct: boolean;
}

export interface ReliabilityBin {
  lo: number;
  hi: number;
  n: number;
  meanConfidence: number;
  accuracy: number;
}

/**
 * Expected Calibration Error with equal-width bins over [0,1]
 * (confidence 1.0 falls in the last bin). Empty input gives ece 0.
 */
export function ece(
  samples: CalibrationSample[],
  binCount = 5,
): { ece: number; bins: ReliabilityBin[] } {
  const buckets: CalibrationSample[][] = Array.from({ length: binCount }, () => []);
  for (const s of samples) {
    const c = Math.min(1, Math.max(0, s.confidence));
    buckets[Math.min(binCount - 1, Math.floor(c * binCount))].push(s);
  }
  let total = 0;
  const bins = buckets.map((b, i) => {
    const meanConfidence = mean(b.map((s) => s.confidence));
    const accuracy = mean(b.map((s) => (s.correct ? 1 : 0)));
    if (b.length > 0) total += (b.length / samples.length) * Math.abs(accuracy - meanConfidence);
    return { lo: i / binCount, hi: (i + 1) / binCount, n: b.length, meanConfidence, accuracy };
  });
  return { ece: samples.length === 0 ? 0 : total, bins };
}

/** DCG of gains in ranked order, truncated to k (log2 discount). */
export function dcg(gains: number[], k = gains.length): number {
  return gains.slice(0, k).reduce((acc, g, i) => acc + (2 ** g - 1) / Math.log2(i + 2), 0);
}

/**
 * nDCG@k. `rankedGains` are the gains in the order the system ranked them;
 * the ideal ordering is derived from the same set. All-zero gains give 0.
 */
export function ndcg(rankedGains: number[], k = 3): number {
  const ideal = dcg([...rankedGains].sort((a, b) => b - a), k);
  return ideal === 0 ? 0 : dcg(rankedGains, k) / ideal;
}

/** Reciprocal rank of the first relevant item (0 when none). */
export function reciprocalRank(rankedRelevant: boolean[]): number {
  const i = rankedRelevant.findIndex(Boolean);
  return i === -1 ? 0 : 1 / (i + 1);
}

export const mrr = (lists: boolean[][]): number => mean(lists.map(reciprocalRank));

/** Fraction of all relevant items that appear in the top k. No relevant items gives 0. */
export function recallAtK(rankedRelevant: boolean[], k: number, totalRelevant?: number): number {
  const total = totalRelevant ?? rankedRelevant.filter(Boolean).length;
  if (total === 0) return 0;
  return rankedRelevant.slice(0, k).filter(Boolean).length / total;
}

/**
 * Precision and recall when everything scoring >= threshold is "selected".
 * Precision reports 0 for an empty selection; recall is 0 when nothing is relevant.
 */
export function precisionRecallAtThreshold(
  items: { score: number; relevant: boolean }[],
  threshold: number,
): { precision: number; recall: number; selected: number } {
  const selected = items.filter((i) => i.score >= threshold);
  const tp = selected.filter((i) => i.relevant).length;
  const relevant = items.filter((i) => i.relevant).length;
  return {
    precision: selected.length === 0 ? 0 : tp / selected.length,
    recall: relevant === 0 ? 0 : tp / relevant,
    selected: selected.length,
  };
}
