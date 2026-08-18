import Database from 'better-sqlite3';
import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/env', () => ({ env: { agentExecutionEnabled: true } }));

import { runMigrations } from '../database/migrations';
import { runPostgresBootstrap } from '../database/postgres_bootstrap';
import { ENROLLMENT_FAILURE_CODES } from '../models/agent_org_experiment_enrollment';

const TABLE = 'agent_org_experiment_enrollments';
// The canonical closed set, read from the SAME model constant migrations.ts
// and postgres_bootstrap.ts are built from — not a hand-copied fixture that
// can silently fall behind when a new code (e.g. target_drifted) is added.
const FAILURE_CODES = ENROLLMENT_FAILURE_CODES;

function squash(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function sqliteColumns(): string[] {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  const columns = (db.pragma(`table_info(${TABLE})`) as { name: string }[])
    .map(({ name }) => name)
    .sort();
  db.close();
  return columns;
}

function postgresColumns(sql: string): string[] {
  const marker = `CREATE TABLE IF NOT EXISTS ${TABLE} (`;
  const tableStart = sql.indexOf(marker);
  if (tableStart < 0) return [];

  const open = sql.indexOf('(', tableStart);
  let depth = 0;
  let close = -1;
  for (let index = open; index < sql.length; index += 1) {
    if (sql[index] === '(') depth += 1;
    if (sql[index] === ')' && (depth -= 1) === 0) {
      close = index;
      break;
    }
  }
  if (close < 0) return [];

  return sql
    .slice(open + 1, close)
    .split('\n')
    .map((line) => line.trim().replace(/,$/, ''))
    .filter(Boolean)
    .filter((line) => !/^(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT)\b/i.test(line))
    .map((line) => line.split(/\s+/)[0])
    .filter((name) => /^[a-z_][a-z0-9_]*$/i.test(name))
    .sort();
}

async function emittedPostgresSql(): Promise<string> {
  const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
  const pool = { query } as unknown as Pool;
  await runPostgresBootstrap(pool);
  await runPostgresBootstrap(pool);
  return query.mock.calls.map(([statement]) => String(statement)).join('\n');
}

/**
 * Extract the exact closed set of quoted codes inside the FIRST
 * `NOT IN ( 'a', 'b', ... )` clause following `marker` in `sql`. Used to prove
 * the enforced domain is EXACTLY the canonical set — not merely a superset
 * that happens to contain every canonical code.
 */
function extractDomainSet(sql: string, marker: string): string[] {
  const normalized = squash(sql);
  const markerIndex = normalized.indexOf(marker);
  if (markerIndex < 0) return [];
  const notInIndex = normalized.indexOf('NOT IN (', markerIndex);
  if (notInIndex < 0) return [];
  const open = notInIndex + 'NOT IN ('.length - 1;
  const close = normalized.indexOf(')', open);
  if (close < 0) return [];
  return normalized
    .slice(open + 1, close)
    .split(',')
    .map((s) => s.trim().replace(/^'|'$/g, ''))
    .filter(Boolean)
    .sort();
}

function sqliteEnrollmentTriggerSql(): string {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  const row = db
    .prepare(
      `SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'trg_agent_org_experiment_enrollments_state_insert_domain'`,
    )
    .get() as { sql: string } | undefined;
  db.close();
  return row?.sql ?? '';
}

describe('C1-C-B3 enrollment Postgres schema parity', () => {
  it('emits the exact SQLite enrollment columns and idempotent indexes', async () => {
    const sql = await emittedPostgresSql();

    expect(postgresColumns(sql)).toEqual(sqliteColumns());
    const normalized = squash(sql);
    expect(normalized).toContain(
      "cohort TEXT NOT NULL CHECK (cohort IN ('baseline', 'candidate'))",
    );
    expect(normalized).toContain(
      "state TEXT NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved', 'dispatched', 'treatment_failed', 'terminalized'))",
    );
    expect(normalized).toContain(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_org_experiment_enrollments_run_episode ON ${TABLE}(run_episode_id)`,
    );
    expect(normalized).toContain(
      `CREATE INDEX IF NOT EXISTS idx_agent_org_experiment_enrollments_experiment ON ${TABLE}(experiment_id)`,
    );
    expect(normalized).toContain(
      `ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS failure_code TEXT`,
    );
    expect(normalized).toContain(
      `ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS failure_reason TEXT`,
    );
  });

  it('emits a NULL-safe closed-domain transition guard without destructive DDL', async () => {
    const sql = await emittedPostgresSql();
    const normalized = squash(sql);

    expect(normalized).toContain(
      'CREATE OR REPLACE FUNCTION rhythm_guard_agent_org_experiment_enrollment_state()',
    );
    expect(normalized).toContain(
      'trg_agent_org_experiment_enrollments_state_insert_domain',
    );
    expect(normalized).toContain(
      'trg_agent_org_experiment_enrollments_state_update_domain',
    );
    expect(normalized).toContain('IS DISTINCT FROM');
    expect(normalized).toContain(
      'agent_org_experiment_enrollments state transition is invalid',
    );
    for (const code of FAILURE_CODES) {
      expect(normalized).toContain(`'${code}'`);
      expect(normalized).toContain(`WHEN '${code}' THEN '${code}'`);
    }
    expect(normalized).toContain("OLD.state = 'reserved' AND NEW.state = 'dispatched'");
    expect(normalized).toContain("OLD.state = 'reserved' AND NEW.state = 'treatment_failed'");
    expect(normalized).toContain("OLD.state = 'dispatched' AND NEW.state = 'terminalized'");
    expect(normalized).not.toMatch(
      /(?:DROP TABLE|TRUNCATE|DELETE\s+FROM)\s+(?:TABLE\s+)?agent_org_experiment_enrollments/i,
    );
  });

  it('the canonical closed set includes target_drifted and the Postgres domain check enforces EXACTLY that set (not a superset)', async () => {
    const canonical = [...ENROLLMENT_FAILURE_CODES].sort();
    expect(canonical).toContain('target_drifted');

    const sql = await emittedPostgresSql();
    const domain = extractDomainSet(
      sql,
      'IF NEW.failure_code IS NOT NULL AND NEW.failure_code NOT IN',
    );
    expect(domain).not.toEqual([]);
    expect(domain).toEqual(canonical);
  });

  it('the SQLite insert-domain trigger enforces EXACTLY the same canonical set as Postgres', () => {
    const canonical = [...ENROLLMENT_FAILURE_CODES].sort();
    const sqliteTriggerSql = sqliteEnrollmentTriggerSql();
    expect(sqliteTriggerSql).not.toBe('');
    const domain = extractDomainSet(
      sqliteTriggerSql,
      'NEW.failure_code IS NOT NULL AND NEW.failure_code NOT IN',
    );
    expect(domain).not.toEqual([]);
    expect(domain).toEqual(canonical);
  });
});
