/**
 * C2-B — Postgres DDL parity for the durable, immutable, sanitized treatment
 * receipt table. Static only: Postgres cannot be executed here (see
 * live_postgres_bootstrap.test.ts for the real, gated, disposable-container
 * proof). This file pins the SHAPE of the DDL emitted by
 * `runPostgresBootstrap` — column set, schema_version domain, hash/target_ref
 * domains, the insert-binding function/trigger, the immutability trigger,
 * uniqueness, and the absence of destructive DDL — mirroring
 * agent_org_experiment_enrollments_postgres_parity.test.ts.
 *
 * These assertions characterize the DDL TEXT, not live Postgres behavior —
 * do not read a passing test here as proof the trigger fires against a real
 * server.
 */
import Database from 'better-sqlite3';
import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/env', () => ({ env: { agentExecutionEnabled: true } }));

import { runMigrations } from '../database/migrations';
import { runPostgresBootstrap } from '../database/postgres_bootstrap';

const TABLE = 'agent_org_experiment_treatment_receipts';
const ENROLLMENTS_TABLE = 'agent_org_experiment_enrollments';

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

describe('C2-B treatment receipt Postgres schema parity', () => {
  it('emits the exact SQLite receipt columns', async () => {
    const sql = await emittedPostgresSql();
    expect(postgresColumns(sql)).toEqual(sqliteColumns());
  });

  it('closes schema_version to exactly 1 in both engines', async () => {
    const sql = await emittedPostgresSql();
    const normalized = squash(sql);
    expect(normalized).toContain('schema_version INTEGER NOT NULL CHECK (schema_version = 1)');

    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    const sqliteDdl = (
      db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`).get(TABLE) as { sql: string }
    ).sql;
    db.close();
    expect(squash(sqliteDdl)).toContain('schema_version INTEGER NOT NULL CHECK (schema_version = 1)');
  });

  it('enforces target_ref/hash closed domains identically to SQLite', async () => {
    const sql = await emittedPostgresSql();
    const normalized = squash(sql);
    expect(normalized).toContain(`target_ref TEXT NOT NULL CHECK (target_ref = ('agent_config:' || profile_id))`);
    expect(normalized).toContain(
      "baseline_target_revision_hash TEXT NOT NULL CHECK (baseline_target_revision_hash ~ '^sha256:[0-9a-f]{64}$')",
    );
    expect(normalized).toContain("treatment_spec_hash TEXT NOT NULL CHECK (treatment_spec_hash ~ '^[0-9a-f]{64}$')");
    expect(normalized).toContain("effective_prompt_hash TEXT NOT NULL CHECK (effective_prompt_hash ~ '^[0-9a-f]{64}$')");
    expect(normalized).toContain("adapter TEXT NOT NULL CHECK (adapter = 'system-prompt-v1')");
    expect(normalized).toContain("cohort TEXT NOT NULL CHECK (cohort IN ('baseline', 'candidate'))");
  });

  it('declares enrollment_id and run_episode_id UNIQUE, with enrollment_id an FK to the enrollment table', async () => {
    const sql = await emittedPostgresSql();
    const normalized = squash(sql);
    expect(normalized).toMatch(
      new RegExp(`enrollment_id TEXT NOT NULL UNIQUE REFERENCES ${ENROLLMENTS_TABLE}\\(id\\)`),
    );
    expect(normalized).toContain('run_episode_id TEXT NOT NULL UNIQUE');
  });

  it('emits an insert-binding function/trigger requiring an exact, dispatched, matching enrollment — without destructive DDL', async () => {
    const sql = await emittedPostgresSql();
    const normalized = squash(sql);

    expect(normalized).toContain(
      'CREATE OR REPLACE FUNCTION rhythm_guard_agent_org_experiment_treatment_receipt_binding()',
    );
    expect(normalized).toContain('trg_agent_org_experiment_treatment_receipts_binding');
    expect(normalized).toContain('BEFORE INSERT ON agent_org_experiment_treatment_receipts');
    expect(normalized).toContain("bound_enrollment.state <> 'dispatched'");
    for (const field of [
      'run_episode_id',
      'experiment_id',
      'proposal_id',
      'profile_id',
      'cohort',
      'assignment_digest',
      'baseline_target_revision_hash',
      'treatment_spec_hash',
    ]) {
      expect(normalized).toContain(`bound_enrollment.${field} <> NEW.${field}`);
    }
    expect(normalized).toContain('treatment receipt does not match its bound dispatched enrollment');
    expect(normalized).not.toMatch(/(?:DROP TABLE|TRUNCATE|DELETE\s+FROM)\s+(?:TABLE\s+)?agent_org_experiment_treatment_receipts/i);
  });

  it('emits an immutability trigger rejecting UPDATE and DELETE — without destructive DDL', async () => {
    const sql = await emittedPostgresSql();
    const normalized = squash(sql);
    expect(normalized).toContain('trg_agent_org_experiment_treatment_receipts_immutable');
    expect(normalized).toContain('BEFORE UPDATE OR DELETE ON agent_org_experiment_treatment_receipts');
    expect(normalized).toContain("rhythm_reject_ledger_write('treatment receipts are immutable once finalized')");
  });
});
