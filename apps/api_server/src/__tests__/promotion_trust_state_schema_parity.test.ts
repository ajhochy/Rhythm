/**
 * D4.1 (#1439) — dual-DB schema parity guard for `promotion_trust_state`,
 * mirroring org_settings_schema_parity.test.ts's approach for another
 * deliberately minimal singleton table.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { runMigrations } from '../database/migrations';

function sqliteColumns(table: string): string[] {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  const cols = (db.pragma(`table_info(${table})`) as { name: string }[]).map((c) => c.name);
  db.close();
  return cols.sort();
}

function postgresColumns(source: string, table: string): string[] {
  const cols = new Set<string>();
  const createRe = new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\s*\\(([\\s\\S]*?)\\)\\s*\``, 'i');
  const createMatch = source.match(createRe);
  if (createMatch) {
    for (const rawLine of createMatch[1].split('\n')) {
      const line = rawLine.trim().replace(/,$/, '');
      if (!line || line.startsWith('--')) continue;
      if (/^(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT)\b/i.test(line)) continue;
      const name = line.split(/\s+/)[0];
      if (/^[a-z_][a-z0-9_]*$/i.test(name)) cols.add(name);
    }
  }
  const alterRe = new RegExp(`ALTER TABLE ${table} ADD COLUMN (?:IF NOT EXISTS )?([a-z_][a-z0-9_]*)`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = alterRe.exec(source)) !== null) cols.add(m[1]);
  return [...cols].sort();
}

describe('#1439 promotion_trust_state dual-DB schema parity', () => {
  it('has identical column sets in SQLite and Postgres', () => {
    const pgSource = readFileSync(join(__dirname, '..', 'database', 'postgres_bootstrap.ts'), 'utf8');
    const sqlite = sqliteColumns('promotion_trust_state');
    const pg = postgresColumns(pgSource, 'promotion_trust_state');
    expect(sqlite).toEqual([
      'auto_promotion_eligible',
      'auto_promotion_enabled',
      'enabled_at',
      'id',
      'total_regressions',
      'total_verified',
      'trust_threshold',
      'updated_at',
    ]);
    expect(pg).toEqual(sqlite);
  });
});
