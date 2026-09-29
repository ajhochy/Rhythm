import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { env as appEnv } from '../config/env';
import { scanOutputRow } from '../services/org_exercised_tools_resolver';
import { logger } from '../utils/logger';

// Session-DB retention (docs/ai/decisions/2026-09-29-session-db-retention.md).
// Distills bulky tool payloads older than N days, in sessions idle N days, in both the engine's
// opencode.db `part` rows and rhythm.db `agent_session_messages.parts_json`. Writes go straight
// to SQLite (not the engine HTTP API: that fans out to SSE and the relay outbox, see #1583), in
// ~200-row transactions with a yield between them, and every UPDATE is guarded so a row the
// engine touched after we read it is skipped. Default mode is dry-run: read-only handles, report only.
// ponytail: no VACUUM / auto_vacuum here — freed pages go to the freelist and are reused; shrinking
// the files is a manual step with the app quit (see the decision doc).

export type RetentionMode = 'off' | 'dry-run' | 'on';
const DAY_MS = 86_400_000;
const OUTPUT_HEAD_CHARS = 2048;
const METADATA_VALUE_MAX = 256;
const FILE_STUB_PREFIX = 'data:text/plain;base64,';
const FILE_STUB_MARKER = 'rhythm-retention-stub';

export function retentionMode(env: Record<string, string | undefined> = process.env): RetentionMode {
  const v = env.RHYTHM_SESSION_RETENTION;
  return v === 'on' || v === 'off' ? v : 'dry-run';
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

function smallScalars(meta: unknown): Rec {
  const out: Rec = {};
  if (!isRec(meta)) return out;
  for (const [k, v] of Object.entries(meta)) {
    const scalar = v === null || ['string', 'number', 'boolean'].includes(typeof v);
    if (scalar && JSON.stringify(v).length < METADATA_VALUE_MAX) out[k] = v;
  }
  return out;
}

/**
 * Returns the distilled copy of a part, or null when the part is kept as-is (non-tool/file parts,
 * every `skill` call, pending/running calls, already-distilled parts, or nothing to shrink).
 * Kept on every tool part: tool, callID, status, input, title, time, error, ids.
 */
export function distillPart(part: unknown, now: Date): Rec | null {
  if (!isRec(part)) return null;
  const stamp = now.toISOString().slice(0, 10);
  let next: Rec;
  if (part.type === 'file') {
    const url = part.url;
    if (typeof url !== 'string' || !url.startsWith('data:') || url.startsWith(FILE_STUB_PREFIX)) return null;
    const payload = url.slice(url.indexOf(',') + 1);
    const bytes = url.includes(';base64,') ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload));
    const stub = {
      [FILE_STUB_MARKER]: stamp,
      type: typeof part.mime === 'string' ? part.mime : 'application/octet-stream',
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
    // text/plain keeps the engine from handing the stub to the model as media on resume.
    next = { ...part, mime: 'text/plain', url: FILE_STUB_PREFIX + Buffer.from(JSON.stringify(stub)).toString('base64') };
  } else if (part.type === 'tool') {
    if (part.tool === 'skill') return null; // skill-usage counting reads all history
    const state = part.state;
    if (!isRec(state) || (state.status !== 'completed' && state.status !== 'error')) return null;
    if (isRec(state.metadata) && state.metadata.retentionPruned) return null;
    const s: Rec = { ...state, metadata: { ...smallScalars(state.metadata), retentionPruned: stamp } };
    if (state.status === 'completed') {
      const output = typeof state.output === 'string' ? state.output : '';
      if (output.length > OUTPUT_HEAD_CHARS) {
        s.output = `${output.slice(0, OUTPUT_HEAD_CHARS)}\n[pruned by retention ${stamp}; ${Buffer.byteLength(output)} bytes]`;
      }
      delete s.attachments;
      if (state.mcpResult !== undefined) {
        s.mcpResult = isRec(state.mcpResult) && typeof state.mcpResult.isError === 'boolean'
          ? { isError: state.mcpResult.isError }
          : {};
      }
      delete s.mcpAppResource;
      const time = isRec(state.time) ? state.time : {};
      // Same marker the engine's own prune sets: resume renders "[Old tool result content cleared]".
      s.time = { ...time, compacted: typeof time.compacted === 'number' ? time.compacted : now.getTime() };
    }
    next = { ...part, state: s };
  } else {
    return null;
  }
  // Only rewrite when it actually frees space; otherwise leave the row exactly as it was.
  return JSON.stringify(next).length < JSON.stringify(part).length ? next : null;
}

export interface StoreReport {
  path: string;
  scannedRows: number;
  eligibleRows: number;
  eligibleParts: number;
  sessionsTouched: number;
  bytesBefore: number;
  bytesAfter: number;
  bytesReclaimable: number;
  byTool: Record<string, { parts: number; bytesReclaimable: number }>;
  oldestEligible: string | null;
  newestEligible: string | null;
  written: number;
  skippedConcurrent: number;
  batches: number;
  /** rhythm.db only: rows the org optimizer's tool scanner reads worse after distilling (target 0). */
  newScannerDefects: number;
  samples: Array<{ before: Rec; after: Rec }>;
  error?: string;
}

export interface RetentionReport {
  mode: RetentionMode;
  days: number;
  cutoff: string;
  startedAt: string;
  finishedAt: string;
  engine: StoreReport | null;
  rhythm: StoreReport | null;
}

export interface RetentionOptions {
  mode: RetentionMode;
  enginePath?: string | null;
  rhythmPath?: string | null;
  days?: number;
  now?: Date;
  batchSize?: number;
  /** Test seam: runs after a batch is read and before it is written. */
  afterBatchRead?: (store: 'engine' | 'rhythm', ids: Array<string | number>) => void;
}

type Resolved = RetentionOptions & { days: number; now: Date; batchSize: number };

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

// Size-only summary, never content: the report is logged and written to disk.
function shapeOf(part: Rec): Rec {
  const state = isRec(part.state) ? part.state : undefined;
  return {
    type: part.type,
    tool: part.tool,
    status: state?.status,
    partBytes: JSON.stringify(part).length,
    outputBytes: typeof state?.output === 'string' ? state.output.length : undefined,
    metadataKeys: isRec(state?.metadata) ? Object.keys(state.metadata) : undefined,
    attachments: Array.isArray(state?.attachments) ? state.attachments.length : undefined,
    compacted: isRec(state?.time) ? state.time.compacted : undefined,
    mime: part.mime,
    urlBytes: typeof part.url === 'string' ? part.url.length : undefined,
  };
}

function emptyReport(p: string): StoreReport {
  return {
    path: p, scannedRows: 0, eligibleRows: 0, eligibleParts: 0, sessionsTouched: 0,
    bytesBefore: 0, bytesAfter: 0, bytesReclaimable: 0, byTool: {},
    oldestEligible: null, newestEligible: null, written: 0, skippedConcurrent: 0, batches: 0, newScannerDefects: 0, samples: [],
  };
}

function tally(r: StoreReport, before: Rec, after: Rec, createdMs: number): void {
  const saved = JSON.stringify(before).length - JSON.stringify(after).length;
  const key = before.type === 'file' ? 'file' : String(before.tool);
  const t = (r.byTool[key] ??= { parts: 0, bytesReclaimable: 0 });
  t.parts += 1;
  t.bytesReclaimable += saved;
  r.eligibleParts += 1;
  const iso = new Date(createdMs).toISOString();
  if (!r.oldestEligible || iso < r.oldestEligible) r.oldestEligible = iso;
  if (!r.newestEligible || iso > r.newestEligible) r.newestEligible = iso;
  if (r.samples.length < 3) r.samples.push({ before: shapeOf(before), after: shapeOf(after) });
}

const openDb = (p: string, mode: RetentionMode): Database.Database => {
  const db = new Database(p, { readonly: mode !== 'on', fileMustExist: true });
  db.pragma('busy_timeout = 5000');
  return db;
};

/** Sessions with a live async delegation in rhythm.db, by both rhythm id and engine sdk id. */
function liveDelegationSessions(rhythm: Database.Database): Set<string> {
  const rows = rhythm.prepare(`
    SELECT s.id, s.sdk_session_id FROM agent_sessions s
     WHERE EXISTS (SELECT 1 FROM agent_async_delegations d
                    WHERE d.status IN ('dispatched', 'waking', 'completed')
                      AND (d.parent_session_id = s.id OR d.child_session_id = s.id))`).all() as
    Array<{ id: string; sdk_session_id: string | null }>;
  const out = new Set<string>();
  for (const r of rows) {
    out.add(r.id);
    if (r.sdk_session_id) out.add(r.sdk_session_id);
  }
  return out;
}

async function runEngine(p: string, o: Resolved, cutoffMs: number, live: Set<string>): Promise<StoreReport> {
  const r = emptyReport(p);
  const db = openDb(p, o.mode);
  try {
    const { maxRowid } = db.prepare(`SELECT COALESCE(MAX(rowid), 0) AS maxRowid FROM part`).get() as { maxRowid: number };
    const select = db.prepare(`
      SELECT p.id, p.session_id, p.time_created, p.time_updated, p.data FROM part p
        JOIN session s ON s.id = p.session_id
       WHERE p.rowid > ? AND p.rowid <= ? AND p.time_created < ? AND s.time_updated < ?
         AND json_extract(p.data, '$.type') IN ('tool', 'file')`);
    const update = o.mode === 'on'
      ? db.prepare(`UPDATE part SET data = ? WHERE id = ? AND time_updated = ? AND data = ?`)
      : null;
    const sessions = new Set<string>();
    for (let from = 0; from < maxRowid; from += o.batchSize) {
      const rows = select.all(from, from + o.batchSize, cutoffMs, cutoffMs) as Array<{
        id: string; session_id: string; time_created: number; time_updated: number; data: string;
      }>;
      r.batches += 1;
      r.scannedRows += rows.length;
      const changes: Array<{ id: string; tu: number; before: string; after: string }> = [];
      for (const row of rows) {
        if (live.has(row.session_id)) continue;
        let part: unknown;
        try { part = JSON.parse(row.data); } catch { continue; }
        const next = distillPart(part, o.now);
        if (!next) continue;
        const after = JSON.stringify(next);
        tally(r, part as Rec, next, row.time_created);
        r.eligibleRows += 1;
        r.bytesBefore += row.data.length;
        r.bytesAfter += after.length;
        sessions.add(row.session_id);
        changes.push({ id: row.id, tu: row.time_updated, before: row.data, after });
      }
      o.afterBatchRead?.('engine', changes.map((c) => c.id));
      if (update && changes.length) {
        db.transaction(() => {
          for (const c of changes) {
            if (update.run(c.after, c.id, c.tu, c.before).changes === 1) r.written += 1;
            else r.skippedConcurrent += 1;
          }
        })();
      }
      await tick();
    }
    r.sessionsTouched = sessions.size;
  } finally {
    db.close();
  }
  r.bytesReclaimable = r.bytesBefore - r.bytesAfter;
  return r;
}

async function runRhythm(p: string, o: Resolved, cutoffMs: number, db: Database.Database, live: Set<string>): Promise<StoreReport> {
  const r = emptyReport(p);
  const ms = (col: string) => `((julianday(${col}) - 2440587.5) * 86400000.0)`;
  const { maxId } = db.prepare(`SELECT COALESCE(MAX(id), 0) AS maxId FROM agent_session_messages`).get() as { maxId: number };
  const select = db.prepare(`
    SELECT m.id, m.session_id, m.sdk_message_id, ${ms('m.created_at')} AS created_ms, m.parts_json FROM agent_session_messages m
      JOIN agent_sessions s ON s.id = m.session_id
     WHERE m.id > ? AND m.id <= ? AND m.parts_json IS NOT NULL
       AND ${ms('m.created_at')} < ?
       AND ${ms('s.updated_at')} < ? AND ${ms('COALESCE(s.last_activity_at, s.updated_at)')} < ?`);
  // The whole prior value is the guard: any live upsertPart since the read makes this a no-op.
  // Direct UPDATE, not upsertPart, so no relay-outbox rows are enqueued (#1583).
  const update = o.mode === 'on'
    ? db.prepare(`UPDATE agent_session_messages SET parts_json = ? WHERE id = ? AND parts_json = ?`)
    : null;
  const sessions = new Set<string>();
  for (let from = 0; from < maxId; from += o.batchSize) {
    const rows = select.all(from, from + o.batchSize, cutoffMs, cutoffMs, cutoffMs) as Array<{
      id: number; session_id: string; sdk_message_id: string | null; created_ms: number; parts_json: string;
    }>;
    r.batches += 1;
    r.scannedRows += rows.length;
    const changes: Array<{ id: number; before: string; after: string }> = [];
    for (const row of rows) {
      if (live.has(row.session_id)) continue;
      let parts: unknown;
      try { parts = JSON.parse(row.parts_json); } catch { continue; }
      if (!Array.isArray(parts)) continue;
      let changed = false;
      const next = parts.map((part: unknown) => {
        const d = distillPart(part, o.now);
        if (!d) return part;
        changed = true;
        tally(r, part as Rec, d, row.created_ms);
        return d;
      });
      if (!changed) continue;
      const after = JSON.stringify(next);
      if (scanOutputRow(after, row.sdk_message_id).defectCount > scanOutputRow(row.parts_json, row.sdk_message_id).defectCount) {
        r.newScannerDefects += 1;
      }
      r.eligibleRows += 1;
      r.bytesBefore += row.parts_json.length;
      r.bytesAfter += after.length;
      sessions.add(row.session_id);
      changes.push({ id: row.id, before: row.parts_json, after });
    }
    o.afterBatchRead?.('rhythm', changes.map((c) => c.id));
    if (update && changes.length) {
      db.transaction(() => {
        for (const c of changes) {
          if (update.run(c.after, c.id, c.before).changes === 1) r.written += 1;
          else r.skippedConcurrent += 1;
        }
      })();
    }
    await tick();
  }
  r.sessionsTouched = sessions.size;
  r.bytesReclaimable = r.bytesBefore - r.bytesAfter;
  return r;
}

export async function runSessionRetention(options: RetentionOptions): Promise<RetentionReport> {
  const o = { days: 30, now: new Date(), batchSize: 200, ...options };
  const cutoffMs = o.now.getTime() - o.days * DAY_MS;
  const report: RetentionReport = {
    mode: o.mode, days: o.days, cutoff: new Date(cutoffMs).toISOString(),
    startedAt: new Date().toISOString(), finishedAt: '', engine: null, rhythm: null,
  };
  if (o.mode === 'off') return { ...report, finishedAt: new Date().toISOString() };
  let live = new Set<string>();
  if (o.rhythmPath) {
    const db = openDb(o.rhythmPath, o.mode);
    try {
      live = liveDelegationSessions(db);
      report.rhythm = await runRhythm(o.rhythmPath, o, cutoffMs, db, live);
    } catch (error) {
      report.rhythm = { ...emptyReport(o.rhythmPath), error: String(error) };
    } finally {
      db.close();
    }
  }
  if (o.enginePath) {
    try {
      report.engine = await runEngine(o.enginePath, o, cutoffMs, live);
    } catch (error) {
      report.engine = { ...emptyReport(o.enginePath), error: String(error) };
    }
  }
  report.finishedAt = new Date().toISOString();
  return report;
}

export function defaultEngineDbPath(env: Record<string, string | undefined> = process.env): string {
  return env.RHYTHM_SESSION_RETENTION_ENGINE_DB
    ?? path.join(env.XDG_DATA_HOME ?? path.join(os.homedir(), '.local', 'share'), 'opencode', 'opencode.db');
}

/** ms until the next local 02:15 — past the #746 engine cold-start window and the nightly jobs. */
export function msUntilNextRun(now: Date = new Date()): number {
  const next = new Date(now);
  next.setHours(2, 15, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

export function startSessionRetentionJob(env: Record<string, string | undefined> = process.env): { stop: () => void } | null {
  const mode = retentionMode(env);
  if (mode === 'off') return null;
  const days = Number(env.RHYTHM_SESSION_RETENTION_DAYS) > 0 ? Number(env.RHYTHM_SESSION_RETENTION_DAYS) : 30;
  const sweep = async (): Promise<void> => {
    try {
      const enginePath = defaultEngineDbPath(env);
      const report = await runSessionRetention({
        mode, days, rhythmPath: appEnv.dbPath, enginePath: fs.existsSync(enginePath) ? enginePath : null,
      });
      const line = (s: StoreReport | null) =>
        s ? `rows=${s.eligibleRows} bytes=${s.bytesReclaimable} written=${s.written} skipped=${s.skippedConcurrent}${s.error ? ` error=${s.error}` : ''}` : 'n/a';
      logger.info(`[session-retention] mode=${mode} engine: ${line(report.engine)} | rhythm: ${line(report.rhythm)}`);
      fs.writeFileSync(path.join(path.dirname(appEnv.dbPath), 'session-retention-report.json'), JSON.stringify(report, null, 2));
    } catch (error) {
      logger.warn(`[session-retention] failed (non-fatal): ${String(error)}`);
    }
  };
  let interval: NodeJS.Timeout | null = null;
  const first = setTimeout(() => {
    void sweep();
    interval = setInterval(() => void sweep(), DAY_MS);
    interval.unref();
  }, msUntilNextRun());
  first.unref();
  return { stop: () => { clearTimeout(first); if (interval) clearInterval(interval); } };
}
