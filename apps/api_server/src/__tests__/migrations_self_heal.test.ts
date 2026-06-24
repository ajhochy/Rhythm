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
