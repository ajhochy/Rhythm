import { env, getDecisionLogMaxRows } from '../../config/env';
import { getDb } from '../../database/db';
import { logger } from '../../utils/logger';

/**
 * Local-only rollout log for the decision engine. Every function is a silent
 * no-op / empty result on Postgres (the table is SQLite-only) and none of the
 * write paths ever throw into the prompt path.
 */
export type DecisionFeature = 'model_routing' | 'tool_ranking' | 'memory_ranking' | 'capacity_routing';

export interface DecisionLogEntry {
  feature: string;
  mode: string;
  sessionId?: string | null;
  status: string;
  applied: boolean;
  chosen?: string | null;
  confidence?: number | null;
  baseline?: string | null;
  latencyMs?: number | null;
  model?: string | null;
  query?: string;
  detail?: Record<string, unknown>;
}

export interface DecisionLogRow {
  id: number;
  createdAt: string;
  feature: string;
  mode: string;
  sessionId: string | null;
  status: string;
  applied: boolean;
  chosen: string | null;
  confidence: number | null;
  baseline: string | null;
  latencyMs: number | null;
  model: string | null;
  queryPreview: string | null;
  detail: Record<string, unknown>;
}

export interface CalibrationBin {
  /** Inclusive lower / exclusive upper bound (last bin includes 1.0). */
  range: [number, number];
  count: number;
  meanConfidence: number | null;
  /** Proxy for accuracy: share of chosen===baseline among rows with a baseline. */
  agreement: number | null;
}

export interface DecisionSummary {
  feature: string;
  total: number;
  ok: number;
  applied: number;
  /** chosen===baseline among ok rows that have both; null when none. */
  agreementRate: number | null;
  latencyMs: { mean: number | null; p50: number | null; p95: number | null };
  calibration: CalibrationBin[];
}

const PREVIEW_CHARS = 160;
const CALIBRATION_BINS = 5;
/** Trim the table after every Nth insert (one DELETE, not per row). */
const TRIM_EVERY = 500;
let warned = false;
let insertsSinceTrim = 0;

function isPostgres(): boolean {
  return env.dbClient === 'postgres';
}

function warnOnce(err: unknown): void {
  if (warned) return;
  warned = true;
  logger.warn(`[Decision] decision log unavailable: ${String(err)}`);
}

export function recordDecision(entry: DecisionLogEntry): void {
  try {
    const preview = entry.query
      ? entry.query.replace(/\s+/g, ' ').trim().slice(0, PREVIEW_CHARS)
      : null;
    logger.info(
      `[Decision] ${JSON.stringify({
        feature: entry.feature,
        mode: entry.mode,
        status: entry.status,
        applied: entry.applied,
        chosen: entry.chosen ?? null,
        baseline: entry.baseline ?? null,
        confidence: entry.confidence ?? null,
        latencyMs: entry.latencyMs ?? null,
      })}`,
    );
    if (isPostgres()) return;
    getDb()
      .prepare(
        `INSERT INTO agent_decision_log
           (feature, mode, session_id, status, applied, chosen, confidence,
            baseline, latency_ms, model, query_preview, detail_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.feature,
        entry.mode,
        entry.sessionId ?? null,
        entry.status,
        entry.applied ? 1 : 0,
        entry.chosen ?? null,
        entry.confidence ?? null,
        entry.baseline ?? null,
        entry.latencyMs === undefined || entry.latencyMs === null
          ? null
          : Math.round(entry.latencyMs),
        entry.model ?? null,
        preview,
        JSON.stringify(entry.detail ?? {}),
      );
    insertsSinceTrim += 1;
    if (insertsSinceTrim >= TRIM_EVERY) {
      insertsSinceTrim = 0;
      trimDecisionLog();
    }
  } catch (err) {
    warnOnce(err);
  }
}

/** Delete the oldest rows beyond AGENT_DECISION_LOG_MAX_ROWS in one statement. */
export function trimDecisionLog(): void {
  const max = getDecisionLogMaxRows();
  getDb()
    .prepare(
      `DELETE FROM agent_decision_log
        WHERE id <= (SELECT id FROM agent_decision_log ORDER BY id DESC LIMIT 1 OFFSET ?)`,
    )
    .run(max);
}

/** Test-only: reset the insert counter. */
export function resetDecisionLogCounterForTests(): void {
  insertsSinceTrim = 0;
}

interface RawRow {
  id: number;
  created_at: string;
  feature: string;
  mode: string;
  session_id: string | null;
  status: string;
  applied: number;
  chosen: string | null;
  confidence: number | null;
  baseline: string | null;
  latency_ms: number | null;
  model: string | null;
  query_preview: string | null;
  detail_json: string;
}

function parseDetail(json: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function listDecisions(opts: { feature?: string; limit?: number } = {}): DecisionLogRow[] {
  if (isPostgres()) return [];
  try {
    const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 50) || 50, 1), 500);
    const rows = (opts.feature
      ? getDb()
          .prepare('SELECT * FROM agent_decision_log WHERE feature = ? ORDER BY id DESC LIMIT ?')
          .all(opts.feature, limit)
      : getDb()
          .prepare('SELECT * FROM agent_decision_log ORDER BY id DESC LIMIT ?')
          .all(limit)) as RawRow[];
    return rows.map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      feature: r.feature,
      mode: r.mode,
      sessionId: r.session_id,
      status: r.status,
      applied: r.applied === 1,
      chosen: r.chosen,
      confidence: r.confidence,
      baseline: r.baseline,
      latencyMs: r.latency_ms,
      model: r.model,
      queryPreview: r.query_preview,
      detail: parseDetail(r.detail_json),
    }));
  } catch (err) {
    warnOnce(err);
    return [];
  }
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
  return sorted[Math.max(idx, 0)];
}

function mean(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
}

export function summarizeDecisions(
  opts: { feature?: string; sinceIso?: string } = {},
): DecisionSummary[] {
  if (isPostgres()) return [];
  try {
    const where: string[] = [];
    const params: string[] = [];
    if (opts.feature) {
      where.push('feature = ?');
      params.push(opts.feature);
    }
    if (opts.sinceIso) {
      where.push('created_at >= ?');
      params.push(opts.sinceIso);
    }
    const rows = getDb()
      .prepare(
        `SELECT feature, status, applied, chosen, confidence, baseline, latency_ms
           FROM agent_decision_log
           ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
          ORDER BY feature`,
      )
      .all(...params) as Pick<
      RawRow,
      'feature' | 'status' | 'applied' | 'chosen' | 'confidence' | 'baseline' | 'latency_ms'
    >[];

    const byFeature = new Map<string, typeof rows>();
    for (const row of rows) {
      const list = byFeature.get(row.feature) ?? [];
      list.push(row);
      byFeature.set(row.feature, list);
    }

    return [...byFeature.entries()].map(([feature, list]) => {
      const okRows = list.filter((r) => r.status === 'ok');
      const comparable = okRows.filter((r) => r.chosen !== null && r.baseline !== null);
      const agrees = (r: (typeof rows)[number]) => r.chosen === r.baseline;
      const latencies = list
        .map((r) => r.latency_ms)
        .filter((v): v is number => v !== null)
        .sort((a, b) => a - b);

      const calibration: CalibrationBin[] = Array.from({ length: CALIBRATION_BINS }, (_, i) => {
        const lo = i / CALIBRATION_BINS;
        const hi = (i + 1) / CALIBRATION_BINS;
        const inBin = okRows.filter((r) => {
          if (r.confidence === null) return false;
          const c = Math.min(Math.max(r.confidence, 0), 1);
          return c >= lo && (c < hi || (i === CALIBRATION_BINS - 1 && c <= hi));
        });
        const binComparable = inBin.filter((r) => r.chosen !== null && r.baseline !== null);
        return {
          range: [lo, hi] as [number, number],
          count: inBin.length,
          meanConfidence: mean(inBin.map((r) => r.confidence as number)),
          agreement:
            binComparable.length === 0
              ? null
              : binComparable.filter(agrees).length / binComparable.length,
        };
      });

      return {
        feature,
        total: list.length,
        ok: okRows.length,
        applied: list.filter((r) => r.applied === 1).length,
        agreementRate:
          comparable.length === 0 ? null : comparable.filter(agrees).length / comparable.length,
        latencyMs: {
          mean: mean(latencies),
          p50: percentile(latencies, 0.5),
          p95: percentile(latencies, 0.95),
        },
        calibration,
      };
    });
  } catch (err) {
    warnOnce(err);
    return [];
  }
}
