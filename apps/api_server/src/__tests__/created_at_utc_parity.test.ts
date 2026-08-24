/**
 * created_at / updated_at zone parity — SQLite must agree with Postgres.
 *
 * ── The defect ──────────────────────────────────────────────────────────────
 * SQLite declared its timestamp columns `DEFAULT (datetime('now'))`, which
 * yields `2026-08-15 20:08:05` — UTC, but with NO zone designator. Postgres
 * yields `2026-08-15T20:08:04.829Z`. Feed both to `new Date(...)` (or Dart's
 * `DateTime.parse`) and the SQLite value is read as LOCAL time:
 *
 *   PG      "2026-08-15T20:08:04.829Z"  -> 2026-08-15T20:08:04.829Z
 *   SQLite  "2026-08-15 20:08:05"       -> 2026-08-16T03:08:05.000Z   (+7h)
 *
 * This repository has already shipped a bug of exactly this species once (the
 * transcript ordering +7h skew, 2026-08-05), which is why
 * `agent_session_messages_repository.toUtcIsoInstant` exists at all.
 *
 * ── What this file locks, and what it deliberately does NOT ─────────────────
 * STAGE 1 (this change) makes every timestamp DEFAULT and every remaining
 * SQL-side timestamp write emit ISO-8601 UTC, so a FRESH database is
 * byte-compatible with Postgres.
 *
 * It does NOT backfill already-migrated databases. `CREATE TABLE IF NOT EXISTS`
 * cannot alter an existing table's DEFAULT, so an existing install keeps
 * emitting the naive format — see `existing databases are untouched` below,
 * which is the executable proof of that claim and of why the backfill has to be
 * its own change. The mixed-format ordering hazard that implies is
 * characterized in `legacy mixed-format rows` below rather than papered over.
 */

import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';

/** ISO-8601, UTC, explicit `Z` — the only shape `new Date()` cannot misread. */
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
/** The naive shape SQLite's `datetime('now')` emits. No zone designator. */
const NAIVE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

describe('created_at UTC parity — SQLite defaults', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = freshDb();
    setDb(db);
  });

  it('declares NO timestamp column whose DEFAULT emits a zone-less value', () => {
    const tables = (
      db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`,
        )
        .all() as { name: string }[]
    ).map((r) => r.name);

    // Any default that resolves through SQLite's clock rather than a literal.
    const offenders: string[] = [];
    for (const table of tables) {
      for (const col of db.pragma(`table_info(${table})`) as {
        name: string;
        dflt_value: string | null;
      }[]) {
        const dflt = col.dflt_value;
        if (!dflt) continue;
        if (/datetime\('now'\)|CURRENT_TIMESTAMP/i.test(dflt)) {
          offenders.push(`${table}.${col.name} DEFAULT ${dflt}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('every clock-valued DEFAULT actually materialises ISO-8601 UTC', () => {
    // Asserting on the DDL text alone would pass for a default that is merely
    // *different*. Execute each one and read the value back.
    const tables = (
      db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`,
        )
        .all() as { name: string }[]
    ).map((r) => r.name);

    const checked: string[] = [];
    const bad: string[] = [];
    for (const table of tables) {
      const info = db.pragma(`table_info(${table})`) as {
        name: string;
        type: string;
        notnull: number;
        dflt_value: string | null;
      }[];
      const clockCols = info.filter(
        (c) => c.dflt_value && /strftime|datetime|CURRENT_TIMESTAMP/i.test(c.dflt_value),
      );
      if (!clockCols.length) continue;

      // Minimal legal row: satisfy NOT NULL columns that have no default.
      const required = info.filter((c) => c.notnull && c.dflt_value === null);
      const cols = required.map((c) => c.name);
      const vals = required.map((c) => (/INT|REAL/i.test(c.type) ? 1 : 'x'));
      let inserted = false;
      try {
        const sql = cols.length
          ? `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`
          : `INSERT INTO ${table} DEFAULT VALUES`;
        db.prepare(sql).run(...vals);
        inserted = true;
      } catch {
        // CHECK/FK/trigger constraints we cannot satisfy generically. The DDL
        // assertion above still covers these tables.
      }
      if (!inserted) continue;

      const row = db
        .prepare(`SELECT ${clockCols.map((c) => c.name).join(',')} FROM ${table} LIMIT 1`)
        .get() as Record<string, unknown>;
      for (const c of clockCols) {
        const value = row[c.name];
        if (typeof value !== 'string') continue;
        checked.push(`${table}.${c.name}`);
        if (!ISO_UTC.test(value)) bad.push(`${table}.${c.name} = ${JSON.stringify(value)}`);
      }
    }

    // Tripwire: if the generic insert stopped working the assertion above would
    // vacuously pass on an empty set.
    expect(checked.length).toBeGreaterThan(20);
    expect(bad).toEqual([]);
  });

  it('is idempotent — running the migration twice changes nothing', () => {
    const snapshot = () =>
      db
        .prepare(
          `SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`,
        )
        .all();
    const before = snapshot();
    runMigrations(db);
    runMigrations(db);
    expect(snapshot()).toEqual(before);

    // And a row inserted after the re-runs is still ISO.
    db.prepare(`INSERT INTO users (id, name, email) VALUES (1, 'T', 't@example.com')`).run();
    db.prepare(`INSERT INTO sessions (token, user_id) VALUES ('t-idem', 1)`).run();
    const row = db
      .prepare(`SELECT created_at FROM sessions WHERE token = 't-idem'`)
      .get() as { created_at: string };
    expect(row.created_at).toMatch(ISO_UTC);
  });
});

describe('created_at UTC parity — the staged-backfill boundary', () => {
  /**
   * The reason Stage 1 stops where it does, made executable.
   *
   * `CREATE TABLE IF NOT EXISTS` is a no-op against a table that already
   * exists, so re-running the NEW migration over an OLD database leaves the
   * OLD default in place. Existing installs therefore keep writing the naive
   * format until a table-rebuild migration lands. If this test ever goes red,
   * the rebuild happened and the report's Stage 2 is done.
   */
  it('existing databases are untouched by the DDL change (why a backfill is still owed)', () => {
    const db = new Database(':memory:');
    // An "old" install: the pre-fix DDL.
    db.exec(
      `CREATE TABLE IF NOT EXISTS sessions (
         token TEXT PRIMARY KEY,
         user_id INTEGER NOT NULL,
         created_at TEXT NOT NULL DEFAULT (datetime('now')),
         expires_at TEXT
       )`,
    );
    db.prepare(`INSERT INTO sessions (token, user_id) VALUES ('legacy', 1)`).run();

    // Now the NEW migration runs over it, exactly as it would on a real upgrade.
    runMigrations(db);
    db.prepare(`INSERT INTO sessions (token, user_id) VALUES ('after-upgrade', 1)`).run();

    const rows = db
      .prepare(`SELECT token, created_at FROM sessions ORDER BY token`)
      .all() as { token: string; created_at: string }[];
    const after = rows.find((r) => r.token === 'after-upgrade')!;

    // Documented, deliberate: the upgrade does NOT convert an existing table.
    expect(after.created_at).toMatch(NAIVE);
    db.close();
  });

  /**
   * THE assertion that catches a naive "just change the default" fix.
   *
   * Because ' ' (0x20) sorts before 'T' (0x54), a column holding both formats
   * orders wrongly under a plain `ORDER BY`. Any change that converts SOME rows
   * and leaves others must fail here.
   */
  it('legacy mixed-format rows: plain ORDER BY is wrong, datetime() ordering is right', () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE t (id TEXT PRIMARY KEY, created_at TEXT)`);
    // True chronological order is a < b < c < d, alternating formats.
    const rows: [string, string][] = [
      ['a', '2026-08-15 10:00:00'],
      ['b', '2026-08-15T11:00:00.000Z'],
      ['c', '2026-08-15 12:00:00'],
      ['d', '2026-08-15T13:00:00.000Z'],
    ];
    for (const r of rows) db.prepare(`INSERT INTO t VALUES (?,?)`).run(...r);

    const order = (sql: string) =>
      (db.prepare(sql).all() as { id: string }[]).map((r) => r.id).join(',');

    // Characterization: this is the trap. Naive values sort before ISO ones.
    expect(order(`SELECT id FROM t ORDER BY created_at`)).toBe('a,c,b,d');

    // SQLite's date parser accepts BOTH shapes, so normalising in SQL restores
    // true chronological order without touching the stored bytes. This is the
    // escape hatch available to any read path that must span the boundary.
    expect(order(`SELECT id FROM t ORDER BY datetime(created_at)`)).toBe('a,b,c,d');

    // A uniformly-ISO column — what a fresh install now has — needs no help.
    db.exec(`DELETE FROM t`);
    for (const [id, ts] of rows) {
      db.prepare(`INSERT INTO t VALUES (?,?)`).run(
        id,
        ts.includes('T') ? ts : ts.replace(' ', 'T') + '.000Z',
      );
    }
    expect(order(`SELECT id FROM t ORDER BY created_at`)).toBe('a,b,c,d');
    db.close();
  });
});

describe('session expiry compared the naive value against an ISO column', () => {
  /**
   * A real defect this parity work surfaced, not a hypothetical.
   *
   * `expires_at` is ALWAYS written from JS as ISO-8601-with-Z (both the SQLite
   * and Postgres create paths). The SQLite lookup compared it lexicographically
   * against `datetime('now')`, which is naive. For the same instant
   * 'T' (0x54) > ' ' (0x20), so an ISO `expires_at` compared "greater than now"
   * whenever the date halves matched — i.e. a session that expired EARLIER
   * TODAY still authenticated, until the UTC date rolled over.
   */
  beforeEach(() => {
    setDb(freshDb());
  });

  it('rejects a token that expired earlier the same UTC day', async () => {
    const { SessionsRepository } = await import('../repositories/sessions_repository');
    const { getDb } = await import('../database/db');
    const repo = new SessionsRepository();

    getDb()
      .prepare(`INSERT INTO users (id, name, email) VALUES (1, 'T', 't@example.com')`)
      .run();
    const session = repo.create(1);

    // Expire it one hour ago — same UTC day, so the date halves still match.
    const anHourAgo = new Date(Date.now() - 3_600_000).toISOString();
    getDb()
      .prepare(`UPDATE sessions SET expires_at = ? WHERE token = ?`)
      .run(anHourAgo, session.token);

    expect(repo.findByToken(session.token)).toBeNull();
  });

  it('still accepts a token that has not expired', async () => {
    const { SessionsRepository } = await import('../repositories/sessions_repository');
    const { getDb } = await import('../database/db');
    const repo = new SessionsRepository();

    getDb()
      .prepare(`INSERT INTO users (id, name, email) VALUES (1, 'T', 't@example.com')`)
      .run();
    const session = repo.create(1);
    expect(repo.findByToken(session.token)).not.toBeNull();

    // And a legacy naive expires_at must still be honoured, in both directions.
    const past = new Date(Date.now() - 3_600_000)
      .toISOString()
      .replace('T', ' ')
      .slice(0, 19);
    getDb()
      .prepare(`UPDATE sessions SET expires_at = ? WHERE token = ?`)
      .run(past, session.token);
    expect(repo.findByToken(session.token)).toBeNull();
  });
});
