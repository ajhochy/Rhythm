/**
 * #792 — Dual-DB schema parity guard for the agent_skills sidecar + the
 * agent_skill_versions ledger. Extended by #1113 to also cover
 * agent_capability_gaps, and by the proposals-parity fix (#1113 sibling) to
 * cover agent_org_proposals too (the same drift class caught both tables
 * missing from postgres_bootstrap.ts entirely). Extended by #1053 (OCU-12) to
 * cover org_skills, the new org skill library table.
 *
 * The skills sidecar/measurement-ledger model must keep the SQLite migration
 * (migrations.ts, the engine of the embedded local server) and the Postgres
 * bootstrap DDL (postgres_bootstrap.ts, production) column-for-column identical.
 * A column that lands in only one DB silently 500s production (per the
 * project_postgres_sqlite_schema_drift hazard), so this test FAILS the moment
 * the two diverge.
 *
 * Strategy:
 *  - SQLite truth: run runMigrations() against an in-memory DB and read the
 *    real resulting column set via PRAGMA table_info — this exercises every
 *    guarded ALTER exactly as production would.
 *  - Postgres truth: the bootstrap runs against a live Pool, so we cannot
 *    execute it here. Instead we statically parse postgres_bootstrap.ts source
 *    for the agent_skills / agent_skill_versions CREATE TABLE column lists plus
 *    every `ALTER TABLE <t> ADD COLUMN [IF NOT EXISTS] <col>` against them.
 *  - Compare the two as sorted column-name sets.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { runMigrations } from '../database/migrations';

const TABLES = [
  'agent_skills',
  'agent_skill_versions',
  'agent_capability_gaps',
  'agent_org_proposals',
  'org_skills',
] as const;

/** Real SQLite column set after all migrations (incl. guarded ALTERs). */
function sqliteColumns(table: string): string[] {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  const cols = (db.pragma(`table_info(${table})`) as { name: string }[]).map(
    (c) => c.name,
  );
  db.close();
  return cols.sort();
}

/**
 * Statically parse the Postgres bootstrap DDL for a table's column set:
 * the `CREATE TABLE IF NOT EXISTS <table> ( ... )` body plus every
 * `ALTER TABLE <table> ADD COLUMN [IF NOT EXISTS] <col>` elsewhere in the file.
 */
function postgresColumns(source: string, table: string): string[] {
  const cols = new Set<string>();

  // 1) CREATE TABLE body.
  const createRe = new RegExp(
    `CREATE TABLE IF NOT EXISTS ${table}\\s*\\(([\\s\\S]*?)\\)\\s*\``,
    'i',
  );
  const createMatch = source.match(createRe);
  if (createMatch) {
    const body = createMatch[1];
    for (const rawLine of body.split('\n')) {
      const line = rawLine.trim().replace(/,$/, '');
      if (!line || line.startsWith('--')) continue;
      // Skip table-level constraint clauses (none today, but be defensive).
      if (/^(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT)\b/i.test(line)) continue;
      const name = line.split(/\s+/)[0];
      if (/^[a-z_][a-z0-9_]*$/i.test(name)) cols.add(name);
    }
  }

  // 2) ALTER TABLE <table> ADD COLUMN [IF NOT EXISTS] <col>.
  const alterRe = new RegExp(
    `ALTER TABLE ${table} ADD COLUMN (?:IF NOT EXISTS )?([a-z_][a-z0-9_]*)`,
    'gi',
  );
  let m: RegExpExecArray | null;
  while ((m = alterRe.exec(source)) !== null) {
    cols.add(m[1]);
  }

  return [...cols].sort();
}

describe('#792 agent_skills dual-DB schema parity', () => {
  const pgSource = readFileSync(
    join(__dirname, '..', 'database', 'postgres_bootstrap.ts'),
    'utf8',
  );

  for (const table of TABLES) {
    it(`${table} has identical column sets in SQLite and Postgres`, () => {
      const sqlite = sqliteColumns(table);
      const pg = postgresColumns(pgSource, table);

      // Sanity: the parser actually found a non-trivial column set.
      expect(sqlite.length).toBeGreaterThan(5);
      expect(pg.length).toBeGreaterThan(5);

      expect(pg).toEqual(sqlite);
    });
  }

  it('agent_skills carries the #792 sidecar + ledger columns', () => {
    const sqlite = sqliteColumns('agent_skills');
    for (const col of [
      'applied_for_name',
      'base_version',
      'origin_location',
      'is_external',
      'baseline_score',
      'post_score',
      'measure_reason',
    ]) {
      expect(sqlite).toContain(col);
    }
  });

  it('issue-798-c7: release CI runs the schema parity guard explicitly', () => {
    const workflow = readFileSync(
      join(__dirname, '..', '..', '..', '..', '.github', 'workflows', 'desktop_release.yml'),
      'utf8',
    );
    expect(workflow).toContain('skill_schema_parity.test.ts');
  });

  it('guards every creative-platform MCP tool in the bundled release', () => {
    const workflow = readFileSync(
      join(__dirname, '..', '..', '..', '..', '.github', 'workflows', 'desktop_release.yml'),
      'utf8',
    );
    // PR #1180: CommonJS output may use `foo(server)` or `(0, foo)(server)`.
    expect(workflow).toContain('assert_grep() {');
    expect(workflow).toContain('grep -qE "$pattern" "$file"');
    for (const guard of [
      '9a2d3e4f-5b6c-4d7e-8f9a-1b2c3d4e5f6a',
      "assert_grep 'creative platform tool registration' \"$DEST/dist/index.js\" 'registerCreativePlatformTools\\)?[[:space:]]*\\([[:space:]]*server'",
      "assert_grep 'setup readiness tool registration' \"$DEST/dist/index.js\" 'registerSetupReadinessTool\\)?[[:space:]]*\\([[:space:]]*server'",
      "assert_grep 'org optimizer tool registration' \"$DEST/dist/index.js\" 'registerOrgOptimizerTools\\)?[[:space:]]*\\([[:space:]]*server'",
      'rhythm_list_creative_capabilities',
      'rhythm_install_creative_capability',
      'rhythm_creative_capability_status',
      'rhythm_verify_creative_capability',
      'rhythm_record_design',
      'rhythm_get_setup_readiness',
      'rhythm_run_external_discovery',
    ]) {
      expect(workflow).toContain(guard);
    }
  });
});
