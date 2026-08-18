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

export class RelayOutboxRepository {
  append(
    tbl: string,
    op: 'upsert' | 'delete',
    pk: string,
    row: Record<string, unknown> | null,
  ): number {
    const result = getDb()
      .prepare(
        `INSERT INTO relay_outbox (tbl, op, pk, row_json)
         VALUES (?, ?, ?, ?)`,
      )
      .run(tbl, op, pk, row === null ? null : JSON.stringify(row));
    return Number(result.lastInsertRowid);
  }

  listSince(seq: number, limit: number): RelayOutboxRow[] {
    const rows = getDb()
      .prepare(
        `SELECT seq, tbl, op, pk, row_json
           FROM relay_outbox
          WHERE seq > ?
          ORDER BY seq
          LIMIT ?`,
      )
      .all(seq, limit) as RelayOutboxDbRow[];
    return rows.map((row) => ({
      seq: row.seq,
      tbl: row.tbl,
      op: row.op,
      pk: row.pk,
      row:
        row.row_json === null
          ? null
          : JSON.parse(row.row_json) as Record<string, unknown>,
    }));
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
  const row = db.prepare(`SELECT * FROM ${tbl} WHERE id = ?`).get(pk) as
    | Record<string, unknown>
    | undefined;
  if (!row) return;
  new RelayOutboxRepository().append(tbl, 'upsert', String(row.id), row);
}

/** Call only from the transaction that deleted the mirror row. */
export function appendRelayDelete(
  tbl: RelayMirrorTable,
  pk: string,
): void {
  if (!replicationEnabled()) return;
  new RelayOutboxRepository().append(tbl, 'delete', pk, null);
}
