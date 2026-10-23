import type Database from 'better-sqlite3';

import { env } from '../config/env';
import { getDb } from '../database/db';
import { COORDINATOR_CONVERSATION_COLUMN } from '../database/coordinator_conversation_schema';

export type RelayMirrorTable =
  | 'agent_sessions'
  | 'agent_session_messages';

export interface RelayOutboxRow {
  seq: number;
  tbl: string;
  op: 'upsert' | 'delete';
  pk: string;
  row: Record<string, unknown> | null;
}

interface RelayOutboxDbRow {
  seq: number;
  tbl: string;
  op: 'upsert' | 'delete';
  pk: string;
  row_json: string | null;
}

const MIRROR_TABLES: ReadonlySet<string> = new Set<RelayMirrorTable>([
  'agent_sessions',
  'agent_session_messages',
]);

// Attachment bytes never cross the relay: a data: URL above this size becomes a placeholder, and
// a row that is still oversized after that is sent without its parts. The uplink socket closes
// on frames above 100 MiB, and resync would resend the same row forever.
const RELAY_DATA_URL_MAX_CHARS = 64 * 1024;
const RELAY_ROW_MAX_CHARS = 16 * 1024 * 1024;

function stripDataUrls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripDataUrls);
  if (value === null || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === 'string' && child.startsWith('data:') && child.length > RELAY_DATA_URL_MAX_CHARS) {
      out.omittedBytes = Math.floor((child.length - child.indexOf(',') - 1) * 0.75);
      continue;
    }
    out[key] = stripDataUrls(child);
  }
  return out;
}

export function relaySafeRow(row: Record<string, unknown>): Record<string, unknown> {
  const parts = row.parts_json;
  if (typeof parts !== 'string' || !parts.includes('data:')) return row;
  let safe = parts;
  try {
    safe = JSON.stringify(stripDataUrls(JSON.parse(parts)));
  } catch {
    // Unparseable parts cannot be inspected; the size cap below still applies.
  }
  const size = Object.values({ ...row, parts_json: safe })
    .reduce<number>((total, value) => total + (typeof value === 'string' ? value.length : 0), 0);
  return { ...row, parts_json: size > RELAY_ROW_MAX_CHARS ? '[]' : safe };
}

// One pending entry per record. An upsert carries no snapshot: the sender reads the live row, so
// a message updated N times while streaming costs one small outbox row, not N growing copies.
// Dropping superseded entries is safe because the relay applies any seq above its last applied.
export class RelayOutboxRepository {
  append(
    tbl: string,
    op: 'upsert' | 'delete',
    pk: string,
    row: Record<string, unknown> | null,
  ): number {
    const db = getDb();
    db.prepare(`DELETE FROM relay_outbox WHERE tbl = ? AND pk = ?`).run(tbl, pk);
    const result = db
      .prepare(
        `INSERT INTO relay_outbox (tbl, op, pk, row_json)
         VALUES (?, ?, ?, ?)`,
      )
      .run(tbl, op, pk, row === null ? null : JSON.stringify(row));
    return Number(result.lastInsertRowid);
  }

  listSince(seq: number, limit: number): RelayOutboxRow[] {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT seq, tbl, op, pk, row_json
           FROM relay_outbox
          WHERE seq > ?
          ORDER BY seq
          LIMIT ?`,
      )
      .all(seq, limit) as RelayOutboxDbRow[];
    return rows.map((row) => {
      const base = { seq: row.seq, tbl: row.tbl, pk: row.pk };
      if (row.op !== 'upsert') return { ...base, op: row.op, row: null };
      const live = MIRROR_TABLES.has(row.tbl)
        ? db.prepare(`SELECT * FROM ${row.tbl} WHERE id = ?`).get(row.pk) as
          | Record<string, unknown>
          | undefined
        : undefined;
      // Gone since it was queued (e.g. a cascade): the replica should drop it too.
      return live
        ? { ...base, op: 'upsert' as const, row: relaySafeRow(live) }
        : { ...base, op: 'delete' as const, row: null };
    });
  }

  pruneThrough(seq: number): void {
    getDb().prepare(`DELETE FROM relay_outbox WHERE seq <= ?`).run(seq);
  }

  maxSeq(): number {
    const row = getDb()
      .prepare(`SELECT COALESCE(MAX(seq), 0) AS seq FROM relay_outbox`)
      .get() as { seq: number };
    return row.seq;
  }
}

function replicationEnabled(): boolean {
  // Optional-chained on purpose: many suites vi.mock '../config/env' with a
  // partial object, and this helper sits inside every mirror-write
  // transaction — it must never throw for an env shape it didn't expect.
  return (env.relayUrls?.length ?? 0) > 0 && env.isRelayRole !== true;
}

/** Call only from the transaction that performed the mirror mutation. */
export function appendRelayUpsert(
  db: Database.Database,
  tbl: RelayMirrorTable,
  pk: string,
): void {
  if (!replicationEnabled()) return;
  if (!db.prepare(`SELECT 1 FROM ${tbl} WHERE id = ?`).get(pk)) return;
  new RelayOutboxRepository().append(tbl, 'upsert', pk, null);
}

/**
 * Call only from the transaction that wrote canonical output/state for a root
 * session. Dirties that root's EXISTING agent_sessions outbox record (full-row
 * replication, coalesced per pk) when — and only when — it is currently a
 * nonarchived, nonchild, nonsystem coordinator primary root, so the relay can
 * learn the root identity and emit its recovery hint. Ordinary/child chats stay
 * untouched. A schema without the coordinator column is simply not a root.
 */
export function appendRelayPrimaryRootUpsert(
  db: Database.Database,
  sessionId: string | number,
): void {
  if (!replicationEnabled()) return;
  const id = String(sessionId);
  try {
    const root = db.prepare(
      `SELECT 1 FROM agent_sessions
        WHERE id = ? AND parent_session_id IS NULL AND is_system = 0
          AND category = 'chat' AND archived_at IS NULL
          AND json_extract(${COORDINATOR_CONVERSATION_COLUMN}, '$.primaryOwnerRoot') = 1`,
    ).get(id);
    if (root) appendRelayUpsert(db, 'agent_sessions', id);
  } catch {
    // Not a coordinator-capable schema/row: nothing to replicate.
  }
}

/** Call only from the transaction that deleted the mirror row. */
export function appendRelayDelete(
  tbl: RelayMirrorTable,
  pk: string,
): void {
  if (!replicationEnabled()) return;
  new RelayOutboxRepository().append(tbl, 'delete', pk, null);
}
