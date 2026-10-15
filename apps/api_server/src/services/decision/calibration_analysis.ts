/**
 * Pure helpers for the router calibration script (scripts/decision_calibrate.ts).
 * No I/O and no engine imports: everything takes plain result rows.
 */

export type Tier = 'cheap' | 'standard' | 'frontier';
export const TIERS: Tier[] = ['cheap', 'standard', 'frontier'];
const RANK: Record<Tier, number> = { cheap: 0, standard: 1, frontier: 2 };

export interface CalibrationRow {
  prompt: string;
  expectedTier: Tier;
  pickedTier: Tier;
  confidence: number;
  margin: number;
  scores: Record<Tier, number>;
}

export interface TierLabel {
  id: Tier;
  description: string;
}

const round = (n: number, d = 4) => Number(n.toFixed(d));

export function overallAccuracy(rows: CalibrationRow[]): number {
  return rows.length === 0 ? 0 : rows.filter((r) => r.expectedTier === r.pickedTier).length / rows.length;
}

export function confusionMatrix(rows: CalibrationRow[]): Record<Tier, Record<Tier, number>> {
  const m = {} as Record<Tier, Record<Tier, number>>;
  for (const e of TIERS) m[e] = { cheap: 0, standard: 0, frontier: 0 };
  for (const r of rows) m[r.expectedTier][r.pickedTier]++;
  return m;
}

export function perTierAccuracy(rows: CalibrationRow[]): Record<Tier, { n: number; hit: number; accuracy: number }> {
  const out = {} as Record<Tier, { n: number; hit: number; accuracy: number }>;
  for (const t of TIERS) {
    const sub = rows.filter((r) => r.expectedTier === t);
    const hit = sub.filter((r) => r.pickedTier === t).length;
    out[t] = { n: sub.length, hit, accuracy: sub.length ? hit / sub.length : 0 };
  }
  return out;
}

export interface SweepRow {
  threshold: number;
  applied: number;
  coverage: number;
  correct: number;
  /** Accuracy among applied rows; null when nothing is applied. */
  accuracy: number | null;
}

export function defaultThresholds(from = 0.3, to = 0.95, step = 0.05): number[] {
  const out: number[] = [];
  for (let i = 0; from + i * step <= to + 1e-9; i++) out.push(round(from + i * step, 2));
  return out;
}

/** Coverage and accuracy-among-applied when only rows with `key >= threshold` are applied. */
export function thresholdSweep(
  rows: CalibrationRow[],
  key: 'confidence' | 'margin',
  thresholds: number[] = defaultThresholds(),
): SweepRow[] {
  return thresholds.map((threshold) => {
    const applied = rows.filter((r) => r[key] >= threshold);
    const correct = applied.filter((r) => r.pickedTier === r.expectedTier).length;
    return {
      threshold,
      applied: applied.length,
      coverage: rows.length ? applied.length / rows.length : 0,
      correct,
      accuracy: applied.length ? correct / applied.length : null,
    };
  });
}

export interface ThresholdRecommendation {
  threshold: number | null;
  row: SweepRow | null;
  /** Best accuracy seen among sweep rows with enough applied prompts (for the none case). */
  best: SweepRow | null;
}

/**
 * Lowest threshold whose applied-accuracy >= target with at least `minApplied`
 * prompts applied (a 100%-accurate single prompt is noise, not a setting).
 */
export function recommendThreshold(sweep: SweepRow[], target = 0.9, minApplied = 3): ThresholdRecommendation {
  const eligible = sweep.filter((s) => s.applied >= minApplied && s.accuracy !== null);
  const hit = eligible.find((s) => (s.accuracy as number) >= target) ?? null;
  const best = eligible.reduce<SweepRow | null>(
    (b, s) => (b === null || (s.accuracy as number) > (b.accuracy as number) ? s : b),
    null,
  );
  return { threshold: hit ? hit.threshold : null, row: hit, best };
}

export interface MarginComparison {
  confidence: ThresholdRecommendation;
  margin: ThresholdRecommendation;
  /** True when margin reaches the target at strictly higher coverage than confidence (or when only margin qualifies). */
  marginBetter: boolean;
  text: string;
}

export function compareMarginToConfidence(rows: CalibrationRow[], target = 0.9, minApplied = 3): MarginComparison {
  const confidence = recommendThreshold(thresholdSweep(rows, 'confidence'), target, minApplied);
  const margin = recommendThreshold(thresholdSweep(rows, 'margin', defaultThresholds(0.05, 0.6, 0.05)), target, minApplied);
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  let marginBetter = false;
  let text: string;
  if (margin.row && !confidence.row) {
    marginBetter = true;
    text = `Margin >= ${margin.threshold?.toFixed(2)} reaches ${pct(margin.row.accuracy as number)} applied-accuracy (coverage ${pct(margin.row.coverage)}); raw confidence never reaches ${pct(target)}. Gate on margin.`;
  } else if (margin.row && confidence.row) {
    marginBetter = margin.row.coverage > confidence.row.coverage + 1e-9;
    text = marginBetter
      ? `Margin >= ${margin.threshold?.toFixed(2)} hits ${pct(target)} at ${pct(margin.row.coverage)} coverage vs ${pct(confidence.row.coverage)} for confidence >= ${confidence.threshold?.toFixed(2)}. Margin separates better.`
      : `Confidence >= ${confidence.threshold?.toFixed(2)} (coverage ${pct(confidence.row.coverage)}) is at least as good as margin >= ${margin.threshold?.toFixed(2)} (coverage ${pct(margin.row.coverage)}). Keep gating on confidence.`;
  } else if (confidence.row) {
    text = `Only confidence qualifies (>= ${confidence.threshold?.toFixed(2)}); margin never reaches ${pct(target)}. Keep gating on confidence.`;
  } else {
    text = `Neither margin nor confidence reaches ${pct(target)} applied-accuracy; fix the descriptions or backend first.`;
  }
  return { confidence, margin, marginBetter, text };
}

export type Direction = 'correct' | 'over' | 'under';

export const directionOf = (r: Pick<CalibrationRow, 'expectedTier' | 'pickedTier'>): Direction =>
  r.pickedTier === r.expectedTier ? 'correct' : RANK[r.pickedTier] > RANK[r.expectedTier] ? 'over' : 'under';

export interface DirectionSummary {
  correct: number;
  over: number;
  under: number;
  /** Highest confidence among the under-routed picks (null when none). */
  underMaxConfidence: number | null;
  recommendation: string | null;
}

export function routeDirection(rows: CalibrationRow[]): DirectionSummary {
  let correct = 0;
  let over = 0;
  const underConf: number[] = [];
  for (const r of rows) {
    const d = directionOf(r);
    if (d === 'correct') correct++;
    else if (d === 'over') over++;
    else underConf.push(r.confidence);
  }
  const under = underConf.length;
  const underMaxConfidence = under > 0 ? Math.max(...underConf) : null;
  let recommendation: string | null = null;
  if (under > over && under > 0) {
    const gate = Math.min(0.95, Math.ceil(((underMaxConfidence as number) + 0.001) * 20) / 20);
    recommendation =
      `Under-routing (${under}, quality risk) outnumbers over-routing (${over}, cost). Use an asymmetric policy: ` +
      `require a higher confidence to pick a tier BELOW the resolver default than ABOVE it ` +
      `(e.g. downward picks need confidence >= ${gate.toFixed(2)}, which would have blocked all ${under} under-routed picks here; upward picks keep the base threshold).`;
  } else if (over > under && over > 0) {
    recommendation = `Over-routing (${over}, extra cost) outnumbers under-routing (${under}); quality is safe, so cost is the lever: tighten the frontier description or raise the threshold for upward picks.`;
  }
  return { correct, over, under, underMaxConfidence, recommendation };
}

export interface ScaleDiagnostic {
  spread: number;
  outOfRange: boolean;
  narrow: boolean;
  recommendation: string | null;
}

/**
 * Score-scale check. `spread` is the mean per-prompt (max - min) over the three
 * tier scores. A narrow band (or any score outside [0,1]) usually means logits
 * were read as probabilities (or the other way round).
 */
export function scoreScaleDiagnostic(
  rows: CalibrationRow[],
  opts: { narrowSpread?: number; rawOutOfRange?: boolean } = {},
): ScaleDiagnostic {
  const narrowSpread = opts.narrowSpread ?? 0.15;
  const spreads = rows.map((r) => {
    const v = TIERS.map((t) => r.scores[t]);
    return Math.max(...v) - Math.min(...v);
  });
  const spread = spreads.length ? spreads.reduce((a, b) => a + b, 0) / spreads.length : 0;
  const outOfRange =
    Boolean(opts.rawOutOfRange) || rows.some((r) => TIERS.some((t) => r.scores[t] < 0 || r.scores[t] > 1));
  const narrow = rows.length > 0 && spread < narrowSpread;
  let recommendation: string | null = null;
  if (outOfRange) {
    recommendation = 'Raw scores outside [0,1] were observed: set AGENT_DECISION_SCORE_SCALE=logit (sigmoid) for logit backends such as llama.cpp, or =probability if the server already returns probabilities.';
  } else if (narrow) {
    recommendation = `Scores cluster in a narrow band (mean spread ${spread.toFixed(3)} < ${narrowSpread}). Try AGENT_DECISION_SCORE_SCALE=logit (raw logits misread as probabilities) or AGENT_DECISION_SCORE_SCALE=probability (sigmoid applied twice), rerun, and keep whichever widens the spread.`;
  }
  return { spread, outOfRange, narrow, recommendation };
}

const STOP = new Set([
  'the', 'a', 'an', 'to', 'of', 'and', 'or', 'for', 'in', 'on', 'is', 'are', 'my', 'me', 'i', 'we', 'it',
  'this', 'that', 'what', 'how', 'with', 'at', 'do', 'does', 'be', 'by', 'from', 'as', 'so', 'you', 'your',
  'our', 'can', 'will', 'then', 'them', 'its', 'not', 'no', 'if', 'but', 'all', 'any', 'into', 'than', 'out',
]);

/** Lowercase alphanumeric tokens, stop words and 1-char tokens removed. */
export function tokenize(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1 && !STOP.has(t));
}

/** Loose stem so "debugging"/"debug", "edits"/"edit" overlap. */
const stem = (t: string) => {
  const base = t.replace(/(ing|ed|es|s)$/, (m, _g, off) => (off >= 3 ? '' : m));
  return /([b-df-hj-np-tv-z])\1$/.test(base) ? base.slice(0, -1) : base;
};

/** Tokens present in both texts (compared by stem), reported in the prompt's spelling. */
export function tokenOverlap(prompt: string, description: string): string[] {
  const d = new Set(tokenize(description).map(stem));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokenize(prompt)) {
    const s = stem(t);
    if (d.has(s) && !seen.has(s)) {
      seen.add(s);
      out.push(t);
    }
  }
  return out;
}

export interface Misroute {
  prompt: string;
  expectedTier: Tier;
  pickedTier: Tier;
  /** Winner score minus expected-tier score. */
  gap: number;
  overlapWithWinner: string[];
  overlapWithExpected: string[];
}

export interface TierDiagnostic {
  tier: Tier;
  /** Misroutes where this tier's description WON wrongly. */
  overMatches: Misroute[];
  /** Misroutes where this tier was expected but lost. */
  misses: Misroute[];
  suggestions: string[];
}

export function describeMisroutes(rows: CalibrationRow[], labels: TierLabel[]): TierDiagnostic[] {
  const desc = Object.fromEntries(labels.map((l) => [l.id, l.description])) as Record<Tier, string>;
  const mis: Misroute[] = rows
    .filter((r) => r.pickedTier !== r.expectedTier)
    .map((r) => ({
      prompt: r.prompt,
      expectedTier: r.expectedTier,
      pickedTier: r.pickedTier,
      gap: round(r.scores[r.pickedTier] - r.scores[r.expectedTier]),
      overlapWithWinner: tokenOverlap(r.prompt, desc[r.pickedTier] ?? ''),
      overlapWithExpected: tokenOverlap(r.prompt, desc[r.expectedTier] ?? ''),
    }));
  return TIERS.map((tier) => {
    const overMatches = mis.filter((m) => m.pickedTier === tier);
    const misses = mis.filter((m) => m.expectedTier === tier);
    const suggestions: string[] = [];
    if (overMatches.length) {
      const freq = new Map<string, number>();
      for (const m of overMatches) for (const t of m.overlapWithWinner) freq.set(t, (freq.get(t) ?? 0) + 1);
      const top = [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([t]) => `'${t}'`);
      const wrongFor = [...new Set(overMatches.map((m) => m.expectedTier))].join('/');
      suggestions.push(
        top.length
          ? `${tier} description over-matches on ${top.join(', ')} (${overMatches.length} ${wrongFor}-tier prompt${overMatches.length > 1 ? 's' : ''} routed here); consider removing or qualifying ${top[0]} (e.g. 'multi-step', 'across many files') or moving that wording to the ${wrongFor} description.`
          : `${tier} won ${overMatches.length} ${wrongFor}-tier prompt${overMatches.length > 1 ? 's' : ''} with no shared keywords (semantic match); tighten the wording or add contrasting examples.`,
      );
    }
    if (misses.length) {
      const freq = new Map<string, number>();
      for (const m of misses) {
        const p = new Set(tokenize(m.prompt));
        for (const t of p) if (!m.overlapWithExpected.includes(t) && !m.overlapWithWinner.includes(t)) freq.set(t, (freq.get(t) ?? 0) + 1);
      }
      const add = [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 4).map(([t]) => `'${t}'`);
      const lost = [...new Set(misses.map((m) => m.pickedTier))].join('/');
      suggestions.push(
        `${tier} description missed ${misses.length} prompt${misses.length > 1 ? 's' : ''} (lost to ${lost}); consider adding terms like ${add.join(', ') || '(none distinctive)'} to it.`,
      );
    }
    return { tier, overMatches, misses, suggestions };
  });
}

/** Env-var / settings line for a chosen min-confidence. */
export function envLineForThreshold(threshold: number): string {
  return `AGENT_DECISION_ROUTING_MIN_CONFIDENCE=${threshold.toFixed(2)}`;
}
