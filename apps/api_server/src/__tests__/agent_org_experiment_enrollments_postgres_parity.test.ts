import Database from 'better-sqlite3';
import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/env', () => ({ env: { agentExecutionEnabled: true } }));

import { runMigrations } from '../database/migrations';
import { runPostgresBootstrap } from '../database/postgres_bootstrap';

const TABLE = 'agent_org_experiment_enrollments';
const FAILURE_CODES = [
  'pre_dispatch_failed',
  'prompt_dispatch_failed',
  'provider_unavailable',
  'invalid_model',
  'prompt_timeout',
] as const;

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
});
