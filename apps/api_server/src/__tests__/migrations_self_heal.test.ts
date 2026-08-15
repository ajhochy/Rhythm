import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';

// P0 — regression guard for the "missing agent tables" report.
//
// Background: a report claimed agent_skills, agent_scheduled_tasks, and
// agent_cookbook were absent from rhythm.db even though their CREATE TABLE
// statements live in migrations.ts. Investigation proved the migration code is
// correct — runMigrations creates all three on a fresh DB AND on a previously
// populated DB. The file that was queried (the repo-local apps/api_server/
// rhythm.db) is a stale, untracked, gitignored dev artifact that was never
// re-migrated by current code; the live runtime DB
// (~/Library/Application Support/Rhythm/rhythm.db) has all three tables.
//
// These tests lock in the guarantee so a future migration edit that reorders,
// guards, or early-returns past these CREATE statements fails loudly. See
// docs/ai/decisions/2026-06-24-stale-local-rhythm-db.md.

const SELF_HEAL_TABLES = ['agent_skills', 'agent_scheduled_tasks', 'agent_cookbook'] as const;

// Minimal column expectations from migrations.ts (~1210/1274/1396). Not the
// full column set — just enough to catch a stub/partial CREATE.
const EXPECTED_COLUMNS: Record<(typeof SELF_HEAL_TABLES)[number], string[]> = {
  agent_skills: ['id', 'title', 'when_to_use', 'description', 'steps_json', 'status', 'body'],
  agent_scheduled_tasks: [
    'id',
    'name',
    'schedule_type',
    'next_run_at',
    'prompt',
    'allowed_mcps_json',
    'allowed_skills_json',
    'enabled',
  ],
  agent_cookbook: ['id', 'title', 'steps_json', 'bound_config_id'],
};

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  return db;
}

function tableExists(db: Database.Database, name: string): boolean {
  return (
    db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`)
      .get(name) !== undefined
  );
}

function columnsOf(db: Database.Database, table: string): string[] {
  return (db.pragma(`table_info(${table})`) as { name: string }[]).map((c) => c.name);
}

describe('migration self-heal: agent_skills / agent_scheduled_tasks / agent_cookbook (P0)', () => {
  it('fresh DB: runMigrations creates all three tables with their intended columns', () => {
    const db = makeDb();
    runMigrations(db);

    for (const table of SELF_HEAL_TABLES) {
      expect(tableExists(db, table), `${table} should exist after fresh migrate`).toBe(true);
      const cols = columnsOf(db, table);
      for (const col of EXPECTED_COLUMNS[table]) {
        expect(cols, `${table}.${col} should exist`).toContain(col);
      }
    }
    db.close();
  });

  it('existing DB missing the three tables (simulating a DB migrated by older code) self-heals on re-migrate', () => {
    const db = makeDb();
    // Bring the DB to a fully-migrated state, then drop the three tables to
    // simulate a DB that was last migrated before these CREATE statements
    // existed (exactly the stale-artifact scenario from the report).
    runMigrations(db);
    for (const table of SELF_HEAL_TABLES) {
      db.exec(`DROP TABLE IF EXISTS ${table}`);
      expect(tableExists(db, table), `${table} dropped for the test`).toBe(false);
    }

    // Re-running migrations on the existing, populated DB must recreate them.
    expect(() => runMigrations(db)).not.toThrow();

    for (const table of SELF_HEAL_TABLES) {
      expect(tableExists(db, table), `${table} should be recreated on re-migrate`).toBe(true);
      const cols = columnsOf(db, table);
      for (const col of EXPECTED_COLUMNS[table]) {
        expect(cols, `${table}.${col} should exist after self-heal`).toContain(col);
      }
    }
    db.close();
  });

  it('runMigrations is idempotent: a second run on an already-migrated DB does not throw', () => {
    const db = makeDb();
    runMigrations(db);
    expect(() => runMigrations(db)).not.toThrow();
    for (const table of SELF_HEAL_TABLES) {
      expect(tableExists(db, table)).toBe(true);
    }
    db.close();
  });
});

// ── W4 — immutable outcome + append-only feedback ledger ────────────────────
//
// Schema-level guarantees. These assert what the DATABASE refuses, not what a
// service remembers to check: a service guard is bypassed by any second writer
// (a concurrent finalizer, a repair script, a future caller), the schema is not.

describe('W4 ledger schema', () => {
  function migrated(): Database.Database {
    const db = makeDb();
    runMigrations(db);
    return db;
  }

  it('W4-c1: the database itself refuses a second outcome row for the same root run', () => {
    const db = migrated();
    const insert = (id: string) =>
      db
        .prepare(
          `INSERT INTO agent_run_outcomes
             (id, root_session_id, session_id, terminal_status, objective_verdict,
              objective_evidence_json, attribution_json, finalized_at)
           VALUES (?, 'root-1', 'root-1', 'completed', 'success', '{}', '{}', '2026-08-15T00:00:00Z')`,
        )
        .run(id);

    insert('outcome-1');
    expect(() => insert('outcome-2')).toThrow(/UNIQUE/i);
    expect(
      db.prepare(`SELECT COUNT(*) AS n FROM agent_run_outcomes`).get(),
    ).toEqual({ n: 1 });
    db.close();
  });

  it('W4-c2: feedback rows carry source + confidence and the database refuses UPDATE/DELETE', () => {
    const db = migrated();
    const insert = (
      id: string,
      seq: number,
      source: string,
      verdict: string,
      confidence: number,
    ) =>
      db
        .prepare(
          `INSERT INTO agent_run_feedback_events
             (id, root_session_id, seq, source, verdict, confidence, created_at)
           VALUES (?, 'root-1', ?, ?, ?, ?, '2026-08-15T00:00:00Z')`,
        )
        .run(id, seq, source, verdict, confidence);

    insert('fb-1', 1, 'explicit_user', 'success', 1);
    insert('fb-2', 2, 'inferred', 'failure', 0.4);

    // Both verdicts survive; the later contradictory one did not replace the first.
    expect(
      db
        .prepare(
          `SELECT source, verdict FROM agent_run_feedback_events
            WHERE root_session_id = 'root-1' ORDER BY id`,
        )
        .all(),
    ).toEqual([
      { source: 'explicit_user', verdict: 'success' },
      { source: 'inferred', verdict: 'failure' },
    ]);

    expect(() =>
      db.prepare(`UPDATE agent_run_feedback_events SET verdict = 'failure'`).run(),
    ).toThrow(/append-only/i);
    expect(() =>
      db.prepare(`DELETE FROM agent_run_feedback_events`).run(),
    ).toThrow(/append-only/i);

    // source and confidence are mandatory — W6 weights evidence by exactly these.
    expect(() =>
      db
        .prepare(
          `INSERT INTO agent_run_feedback_events
             (id, root_session_id, seq, source, verdict, confidence, created_at)
           VALUES ('fb-3', 'root-1', 3, NULL, 'success', 1, '2026-08-15T00:00:00Z')`,
        )
        .run(),
    ).toThrow(/NOT NULL/i);
    expect(() =>
      db
        .prepare(
          `INSERT INTO agent_run_feedback_events
             (id, root_session_id, seq, source, verdict, confidence, created_at)
           VALUES ('fb-4', 'root-1', 4, 'inferred', 'success', NULL, '2026-08-15T00:00:00Z')`,
        )
        .run(),
    ).toThrow(/NOT NULL/i);
    db.close();
  });

  it('W4-c11: a finalized outcome row cannot be mutated or deleted', () => {
    const db = migrated();
    db.prepare(
      `INSERT INTO agent_run_outcomes
         (id, root_session_id, session_id, terminal_status, objective_verdict,
          objective_evidence_json, attribution_json, finalized_at)
       VALUES ('o-1', 'root-1', 'root-1', 'completed', 'failure', '{}', '{}', '2026-08-15T00:00:00Z')`,
    ).run();

    expect(() =>
      db.prepare(`UPDATE agent_run_outcomes SET objective_verdict = 'success'`).run(),
    ).toThrow(/immutable/i);
    expect(() =>
      db.prepare(`UPDATE agent_run_outcomes SET objective_evidence_json = '{"x":1}'`).run(),
    ).toThrow(/immutable/i);
    expect(() => db.prepare(`DELETE FROM agent_run_outcomes`).run()).toThrow(
      /immutable/i,
    );
    expect(
      db.prepare(`SELECT objective_verdict AS v FROM agent_run_outcomes`).get(),
    ).toEqual({ v: 'failure' });
    db.close();
  });
});
