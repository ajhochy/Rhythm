import type Database from 'better-sqlite3';

import { env } from '../config/env';
import { getDb } from '../database/db';

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
        ? { ...base, op: 'upsert' as const, row: live }
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

/** Call only from the transaction that deleted the mirror row. */
export function appendRelayDelete(
  tbl: RelayMirrorTable,
  pk: string,
): void {
  if (!replicationEnabled()) return;
  new RelayOutboxRepository().append(tbl, 'delete', pk, null);
}
