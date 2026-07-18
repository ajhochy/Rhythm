/**
 * org_settings_repository.ts — #1072 (OCU-31).
 *
 * A single org-wide instructions markdown, hosted on the production API and
 * synced to every local machine's opencode `instructions` config (see
 * opencode_plugin_config.ts's `syncOrgInstructions`). Singleton row
 * (fixed id `'org_instructions'`) rather than a table needing lookup-by-name
 * — there is exactly one org-instructions document today; a second document
 * kind would need its own id, not a new table.
 *
 * Dual-engine (mirrors OrgSkillsRepository / the #1113 pattern): every method
 * branches on `env.dbClient`. SQLite keeps a synchronous better-sqlite3 path;
 * Postgres queries `getPostgresPool()` directly. See postgres_bootstrap.ts
 * for the matching `org_settings` table — the ONLY prod-schema addition in
 * this issue (additive only).
 */

import Database from 'better-sqlite3';
import { env } from '../config/env';
import { getDb, getPostgresPool } from '../database/db';
import { runMigrations } from '../database/migrations';

export const ORG_INSTRUCTIONS_ID = 'org_instructions';

export interface OrgInstructions {
  content: string;
  updatedAt: string;
}

interface OrgSettingsRow {
  id: string;
  content: string;
  updated_at: string | Date;
}

function toIso(value: string | Date): string {
  return typeof value === 'string' ? value : value.toISOString();
}

function rowToModel(row: OrgSettingsRow): OrgInstructions {
  return { content: row.content, updatedAt: toIso(row.updated_at) };
}

function makeInMemoryDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

export class OrgSettingsRepository {
  /** SQLite-only handle. Never populated (and never used) under Postgres. */
  private db: Database.Database | null;

  constructor(db?: Database.Database) {
    if (env.dbClient === 'postgres') {
      this.db = null;
      return;
    }
    if (db) {
      this.db = db;
    } else {
      try {
        this.db = getDb();
      } catch {
        this.db = makeInMemoryDb();
      }
    }
  }

  async getInstructionsAsync(): Promise<OrgInstructions | null> {
    if (env.dbClient === 'postgres') {
      const r = await getPostgresPool().query(
        `SELECT * FROM org_settings WHERE id = $1`,
        [ORG_INSTRUCTIONS_ID],
      );
      return r.rows.length > 0 ? rowToModel(r.rows[0]) : null;
    }
    const row = this.db!
      .prepare(`SELECT * FROM org_settings WHERE id = ?`)
      .get(ORG_INSTRUCTIONS_ID) as OrgSettingsRow | undefined;
    return row ? rowToModel(row) : null;
  }

  async setInstructionsAsync(content: string): Promise<OrgInstructions> {
    const now = new Date().toISOString();
    if (env.dbClient === 'postgres') {
      await getPostgresPool().query(
        `INSERT INTO org_settings (id, content, updated_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content, updated_at = EXCLUDED.updated_at`,
        [ORG_INSTRUCTIONS_ID, content, now],
      );
      return (await this.getInstructionsAsync())!;
    }
    this.db!
      .prepare(
        `INSERT INTO org_settings (id, content, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`,
      )
      .run(ORG_INSTRUCTIONS_ID, content, now);
    return (await this.getInstructionsAsync())!;
  }
}
