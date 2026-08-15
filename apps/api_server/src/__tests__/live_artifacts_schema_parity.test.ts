import { readFileSync } from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';
import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/env', () => ({ env: { agentExecutionEnabled: false } }));

import { runMigrations } from '../database/migrations';
import { runPostgresBootstrap } from '../database/postgres_bootstrap';

/**
 * The approved AV-01 shape. Both dialects are asserted against THIS, not
 * against each other, so a matching drift in both databases still fails.
 *
 * `columns` is compared for exact set equality in each dialect: a column added
 * to one database only, or dropped from one, fails. `definitions` are the
 * column/constraint clauses that must survive verbatim (whitespace-normalized)
 * — they carry the CHECK constraints, defaults, and composite primary keys.
 */
const SPEC = {
  live_artifacts: {
    columns: [
      'id', 'type', 'title', 'owner_user_id', 'workspace_id', 'visibility',
      'current_bundle_revision', 'current_bundle_hash', 'current_state_revision',
      'current_state_hash', 'declared_capabilities_json', 'created_at', 'updated_at',
      'updated_by_user_id', 'deleted_at', 'deleted_by_user_id',
    ],
    definitions: [
      // Explicit NOT NULL, not just PRIMARY KEY: SQLite permits a NULL TEXT
      // primary key, Postgres does not. Dropping it re-opens that divergence.
      'id TEXT PRIMARY KEY NOT NULL',
      "type TEXT NOT NULL CHECK (type = 'html')",
      'title TEXT NOT NULL',
      'owner_user_id INTEGER NOT NULL REFERENCES users(id)',
      'workspace_id INTEGER NOT NULL REFERENCES workspaces(id)',
      "visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'shared', 'organization'))",
      'current_bundle_revision INTEGER NOT NULL CHECK (current_bundle_revision > 0)',
      'current_bundle_hash TEXT NOT NULL CHECK (length(current_bundle_hash) = 64)',
      'current_state_revision INTEGER NOT NULL CHECK (current_state_revision > 0)',
      'current_state_hash TEXT NOT NULL CHECK (length(current_state_hash) = 64)',
      "declared_capabilities_json TEXT NOT NULL DEFAULT '[]'",
      'updated_by_user_id INTEGER NOT NULL REFERENCES users(id)',
      'deleted_at TEXT',
      'deleted_by_user_id INTEGER REFERENCES users(id)',
    ],
    // Soft-delete audit stays nullable; everything else is required.
    nullable: ['deleted_at', 'deleted_by_user_id'],
    primaryKey: ['id'],
    timestampDefaults: ['created_at', 'updated_at'],
  },
  live_artifact_collaborators: {
    columns: ['artifact_id', 'user_id', 'added_at', 'added_by_user_id'],
    definitions: [
      'artifact_id TEXT NOT NULL REFERENCES live_artifacts(id)',
      'user_id INTEGER NOT NULL REFERENCES users(id)',
      'added_by_user_id INTEGER NOT NULL REFERENCES users(id)',
      'PRIMARY KEY (artifact_id, user_id)',
    ],
    nullable: [],
    primaryKey: ['artifact_id', 'user_id'],
    timestampDefaults: ['added_at'],
  },
  live_artifact_bundle_revisions: {
    columns: ['artifact_id', 'revision', 'hash', 'actor_user_id', 'created_at'],
    definitions: [
      'artifact_id TEXT NOT NULL REFERENCES live_artifacts(id)',
      'revision INTEGER NOT NULL CHECK (revision > 0)',
      'hash TEXT NOT NULL CHECK (length(hash) = 64)',
      'actor_user_id INTEGER NOT NULL REFERENCES users(id)',
      'PRIMARY KEY (artifact_id, revision)',
    ],
    nullable: [],
    primaryKey: ['artifact_id', 'revision'],
    timestampDefaults: ['created_at'],
  },
  live_artifact_state_revisions: {
    columns: ['artifact_id', 'revision', 'hash', 'actor_user_id', 'created_at'],
    definitions: [
      'artifact_id TEXT NOT NULL REFERENCES live_artifacts(id)',
      'revision INTEGER NOT NULL CHECK (revision > 0)',
      'hash TEXT NOT NULL CHECK (length(hash) = 64)',
      'actor_user_id INTEGER NOT NULL REFERENCES users(id)',
      'PRIMARY KEY (artifact_id, revision)',
    ],
    nullable: [],
    primaryKey: ['artifact_id', 'revision'],
    timestampDefaults: ['created_at'],
  },
} as const;

const REQUIRED_INDEXES: Record<string, string> = {
  idx_live_artifacts_workspace_visibility: 'live_artifacts(workspace_id, visibility, deleted_at)',
  idx_live_artifacts_owner_updated: 'live_artifacts(owner_user_id, updated_at DESC)',
  idx_live_artifact_collaborators_user: 'live_artifact_collaborators(user_id, artifact_id)',
};

const TABLES = Object.keys(SPEC) as (keyof typeof SPEC)[];

// `--` comments carry commas and parens that would confuse the clause split
// below. No `--` appears inside a string literal in this DDL.
const stripComments = (sql: string): string => sql.replace(/--[^\n]*/g, '');
const squash = (sql: string): string => stripComments(sql).replace(/\s+/g, ' ').trim();

/** Body of `CREATE TABLE IF NOT EXISTS <table> ( … )`, paren-depth matched. */
function createTableBody(sql: string, table: string): string {
  const open = sql.indexOf(`CREATE TABLE IF NOT EXISTS ${table} (`);
  if (open < 0) throw new Error(`no CREATE TABLE IF NOT EXISTS for ${table}`);
  const start = sql.indexOf('(', open);
  let depth = 0;
  for (let i = start; i < sql.length; i += 1) {
    if (sql[i] === '(') depth += 1;
    else if (sql[i] === ')' && (depth -= 1) === 0) return sql.slice(start + 1, i);
  }
  throw new Error(`unterminated CREATE TABLE for ${table}`);
}

/** Column names declared in a CREATE TABLE body (table constraints excluded). */
function declaredColumns(body: string): string[] {
  const clauses: string[] = [];
  let depth = 0;
  let buf = '';
  for (const ch of body) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) { clauses.push(buf); buf = ''; continue; }
    buf += ch;
  }
  clauses.push(buf);
  return clauses
    .map((clause) => squash(clause))
    .filter(Boolean)
    .filter((clause) => !/^(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT)\b/i.test(clause))
    .map((clause) => clause.split(' ')[0]);
}

describe('live-artifact schema parity (AV-01)', () => {
  // Regression: a new artifact field can land in only one database and fail at
  // hosted startup. These assertions inspect the real SQLite migration and all
  // SQL emitted by the Postgres bootstrap, then rerun both bootstrap paths.
  it('creates equivalent, idempotent artifact metadata and user-tab schema', async () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    runMigrations(sqlite);
    expect(() => runMigrations(sqlite)).not.toThrow();

    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    await runPostgresBootstrap({ query } as unknown as Pool);
    await runPostgresBootstrap({ query } as unknown as Pool);
    const postgresSql = stripComments(
      query.mock.calls.map(([statement]) => String(statement)).join('\n'),
    );

    for (const table of TABLES) {
      const spec = SPEC[table];

      const sqliteDdl = (sqlite
        .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(table) as { sql: string } | undefined)?.sql;
      expect(sqliteDdl, `SQLite is missing ${table}`).toBeTruthy();
      const postgresBody = createTableBody(postgresSql, table);

      // Exact column sets in BOTH dialects — added or dropped columns fail.
      const sqliteColumns = (sqlite.pragma(`table_info(${table})`) as Array<{
        name: string; notnull: number; dflt_value: string | null; pk: number;
      }>);
      expect(sqliteColumns.map(({ name }) => name).sort(), `SQLite columns drifted on ${table}`)
        .toEqual([...spec.columns].sort());
      expect(declaredColumns(postgresBody).sort(), `Postgres columns drifted on ${table}`)
        .toEqual([...spec.columns].sort());

      // Constraints, defaults, and composite primary keys, in both dialects.
      for (const definition of spec.definitions) {
        expect(squash(sqliteDdl!), `SQLite ${table} lost: ${definition}`).toContain(definition);
        expect(squash(postgresBody), `Postgres ${table} lost: ${definition}`).toContain(definition);
      }

      // Timestamp defaults use each dialect's own now-expression, so assert the
      // column stays NOT NULL with a default rather than a literal expression.
      //
      // The SQLite side additionally pins the ZONE-SAFE expression. It used to
      // accept `datetime('now')`, which yields a designator-less
      // "YYYY-MM-DD HH:MM:SS" that `new Date()`/`DateTime.parse` read as LOCAL
      // time — a 7-hour skew against the Postgres column of the same name.
      // Asserting the exact expression is what keeps the two engines agreeing
      // on the INSTANT, not merely on the column name.
      for (const column of spec.timestampDefaults) {
        expect(squash(postgresBody), `Postgres ${table}.${column} lost its default`)
          .toMatch(new RegExp(`${column} TEXT NOT NULL DEFAULT \\(`));
        const sqliteColumn = sqliteColumns.find(({ name }) => name === column);
        expect(sqliteColumn, `SQLite ${table}.${column} missing`).toMatchObject({ notnull: 1 });
        expect(sqliteColumn?.dflt_value, `SQLite ${table}.${column} lost its UTC default`)
          .toContain("strftime('%Y-%m-%dT%H:%M:%fZ','now')");
      }

      // Nullability and primary-key ordinals, structurally introspected.
      for (const { name, notnull } of sqliteColumns) {
        expect(notnull === 0, `SQLite ${table}.${name} nullability drifted`)
          .toBe((spec.nullable as readonly string[]).includes(name));
      }
      const sqlitePk = sqliteColumns
        .filter(({ pk }) => pk > 0)
        .sort((a, b) => a.pk - b.pk)
        .map(({ name }) => name);
      expect(sqlitePk, `SQLite ${table} primary key drifted`).toEqual([...spec.primaryKey]);
    }

    // Required indexes must exist in both dialects, on the same expression.
    for (const [index, definition] of Object.entries(REQUIRED_INDEXES)) {
      const sqliteIndex = sqlite
        .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?")
        .get(index) as { sql: string } | undefined;
      expect(sqliteIndex, `SQLite is missing ${index}`).toBeTruthy();
      expect(squash(sqliteIndex!.sql), `SQLite ${index} definition drifted`).toContain(definition);
      expect(squash(postgresSql), `Postgres is missing ${index}`)
        .toContain(`CREATE INDEX IF NOT EXISTS ${index} ON ${definition}`);
    }

    // Per-user ordered artifact tab preference, additive in both dialects.
    const artifactTabs = (sqlite.pragma('table_info(users)') as Array<{
      name: string; notnull: number; dflt_value: string | null;
    }>).find(({ name }) => name === 'artifact_tab_ids_json');
    expect(artifactTabs, 'SQLite users.artifact_tab_ids_json missing').toMatchObject({
      notnull: 1,
      dflt_value: "'[]'",
    });
    expect(squash(postgresSql)).toContain(
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS artifact_tab_ids_json TEXT NOT NULL DEFAULT '[]'",
    );

    // No destructive SQL against artifact tables (contract c3).
    expect(postgresSql).not.toMatch(/(?:DROP|TRUNCATE|DELETE\s+FROM)\s+(?:TABLE\s+)?live_artifact/i);

    expect(readFileSync(path.resolve(__dirname, '../config/env.ts'), 'utf8')).toContain('LIVE_ARTIFACT_STORAGE_DIR');
    expect(readFileSync(path.resolve(__dirname, '../../.env.production.example'), 'utf8')).toContain('LIVE_ARTIFACT_STORAGE_DIR=/data/live-artifacts');
    expect(readFileSync(path.resolve(__dirname, '../../../../tools/dev/sandbox.sh'), 'utf8')).toContain('LIVE_ARTIFACT_STORAGE_DIR=$SB/live-artifacts');
    sqlite.close();
  });
});
