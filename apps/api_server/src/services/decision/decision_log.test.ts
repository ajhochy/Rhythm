import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import { runMigrations } from '../../database/migrations';
import { setDb } from '../../database/db';
import { listDecisions, recordDecision, summarizeDecisions } from './decision_log';

let db: Database.Database;
let previous: Database.Database | null;

beforeEach(() => {
  db = new Database(':memory:');
  runMigrations(db);
  previous = setDb(db);
});

afterEach(() => {
  setDb(previous);
  db.close();
});

describe('decision log', () => {
  it('records and lists newest first with a collapsed 160-char preview', () => {
    recordDecision({ feature: 'model_routing', mode: 'shadow', status: 'ok', applied: false, chosen: 'cheap', baseline: 'standard', confidence: 0.7, latencyMs: 12.4, model: 'm', query: `a\n\n  b ${'x'.repeat(300)}`, detail: { k: 1 } });
    recordDecision({ feature: 'tool_ranking', mode: 'on', status: 'timeout', applied: false });
    const rows = listDecisions();
    expect(rows.map((r) => r.feature)).toEqual(['tool_ranking', 'model_routing']);
    const r = rows[1];
    expect(r.queryPreview).toHaveLength(160);
    expect(r.queryPreview!.startsWith('a b x')).toBe(true);
    expect(r).toMatchObject({ latencyMs: 12, applied: false, detail: { k: 1 } });
    expect(listDecisions({ feature: 'tool_ranking' })).toHaveLength(1);
    expect(listDecisions({ limit: 1 })).toHaveLength(1);
  });

  it('summarizes agreement, latency percentiles and calibration bins', () => {
    const rows: [string, string, number, number, boolean][] = [
      // chosen, baseline, confidence, latency, applied
      ['a', 'a', 0.95, 10, true],
      ['a', 'b', 0.9, 20, false],
      ['b', 'b', 0.3, 30, false],
      ['c', 'c', 0.05, 40, false],
    ];
    for (const [chosen, baseline, confidence, latencyMs, applied] of rows) {
      recordDecision({ feature: 'model_routing', mode: 'shadow', status: 'ok', applied, chosen, baseline, confidence, latencyMs });
    }
    recordDecision({ feature: 'model_routing', mode: 'shadow', status: 'error', applied: false, latencyMs: 50 });
    const [s] = summarizeDecisions({ feature: 'model_routing' });
    expect(s).toMatchObject({ feature: 'model_routing', total: 5, ok: 4, applied: 1, agreementRate: 0.75 });
    expect(s.latencyMs).toEqual({ mean: 30, p50: 30, p95: 50 });
    expect(s.calibration).toHaveLength(5);
    expect(s.calibration.map((b) => b.count)).toEqual([1, 1, 0, 0, 2]);
    expect(s.calibration[4].agreement).toBe(0.5);
    expect(s.calibration[4].meanConfidence).toBeCloseTo(0.925, 10);
    expect(s.calibration[2].meanConfidence).toBeNull();
  });

  it('filters summaries by sinceIso and groups per feature', () => {
    recordDecision({ feature: 'tool_ranking', mode: 'on', status: 'ok', applied: true });
    recordDecision({ feature: 'memory_ranking', mode: 'on', status: 'ok', applied: true });
    expect(summarizeDecisions().map((s) => s.feature).sort()).toEqual(['memory_ranking', 'tool_ranking']);
    expect(summarizeDecisions({ sinceIso: '2999-01-01T00:00:00Z' })).toEqual([]);
  });

  it('never throws when the database is unavailable', () => {
    setDb(null);
    expect(() => recordDecision({ feature: 'x', mode: 'on', status: 'ok', applied: false })).not.toThrow();
    expect(listDecisions()).toEqual([]);
    expect(summarizeDecisions()).toEqual([]);
  });
});
