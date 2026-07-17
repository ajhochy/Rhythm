/**
 * org_skills_repository.ts — #1053 (OCU-12).
 *
 * The org's shared skill library, one row per skill. Single-file model:
 * `content` is the complete SKILL.md body — the only file this table backs
 * today. ponytail: a skill that needs to bundle extra reference files would
 * need a files table instead of one `content` column; add that only when
 * #1056's publish pipeline actually needs to carry more than SKILL.md.
 *
 * Dual-engine (mirrors AgentCapabilityGapsRepository / AgentOrgProposalsRepository,
 * the #1113 pattern): every method branches on `env.dbClient`. SQLite keeps a
 * synchronous better-sqlite3 path; Postgres queries `getPostgresPool()`
 * directly. See postgres_bootstrap.ts for the matching `org_skills` table.
 *
 * `published = false` hides a row from every public read (index.json AND
 * direct file fetch) — a skill not yet approved for the org library must not
 * be readable by guessing its name.
 */

import Database from 'better-sqlite3';
import { env } from '../config/env';
import { getDb, getPostgresPool } from '../database/db';
import { runMigrations } from '../database/migrations';

export interface OrgSkill {
  name: string;
  description: string | null;
  content: string;
  published: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OrgSkillInput {
  description?: string | null;
  content: string;
  /** Defaults to true (published) when omitted. */
  published?: boolean;
}

/**
 * Raw DB row shape (snake_case) — internal only, never exported.
 * created_at/updated_at come back as a plain string from SQLite (TEXT) but as
 * a native Date from the `pg` driver (Postgres columns are TIMESTAMPTZ);
 * `published` comes back as 0/1 from SQLite but a real boolean from `pg`.
 * rowToModel normalizes both.
 */
interface OrgSkillRow {
  name: string;
  description: string | null;
  content: string;
  published: number | boolean;
  created_at: string | Date;
  updated_at: string | Date;
}

function toIso(value: string | Date): string {
  return typeof value === 'string' ? value : value.toISOString();
}

function rowToModel(row: OrgSkillRow): OrgSkill {
  return {
    name: row.name,
    description: row.description ?? null,
    content: row.content,
    published: Boolean(row.published),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function makeInMemoryDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

export class OrgSkillsRepository {
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
        // No global DB initialized (e.g. a unit test that never called
        // initDb()) — create a throwaway in-memory instance. SQLite-only:
        // Postgres never falls back here (see constructor guard above).
        this.db = makeInMemoryDb();
      }
    }
  }

  private async findByNamePg(name: string): Promise<OrgSkill | null> {
    const r = await getPostgresPool().query(`SELECT * FROM org_skills WHERE name = $1`, [name]);
    return r.rows.length > 0 ? rowToModel(r.rows[0]) : null;
  }

  /** Any row regardless of published state — internal existence checks. */
  async findByNameAsync(name: string): Promise<OrgSkill | null> {
    if (env.dbClient === 'postgres') return this.findByNamePg(name);
    const row = this.db!
      .prepare(`SELECT * FROM org_skills WHERE name = ?`)
      .get(name) as OrgSkillRow | undefined;
    return row ? rowToModel(row) : null;
  }

  /** Only a published row — the public read path (index.json + file serving). */
  async findPublishedByNameAsync(name: string): Promise<OrgSkill | null> {
    const skill = await this.findByNameAsync(name);
    return skill && skill.published ? skill : null;
  }

  async listPublishedAsync(): Promise<OrgSkill[]> {
    if (env.dbClient === 'postgres') {
      const r = await getPostgresPool().query(
        `SELECT * FROM org_skills WHERE published = TRUE ORDER BY name`,
      );
      return r.rows.map(rowToModel);
    }
    const rows = this.db!
      .prepare(`SELECT * FROM org_skills WHERE published = 1 ORDER BY name`)
      .all() as OrgSkillRow[];
    return rows.map(rowToModel);
  }

  /** Create or overwrite the named skill (upsert on the `name` primary key). */
  async upsertAsync(name: string, input: OrgSkillInput): Promise<OrgSkill> {
    const now = new Date().toISOString();
    const description = input.description ?? null;
    const published = input.published !== false;

    if (env.dbClient === 'postgres') {
      await getPostgresPool().query(
        `INSERT INTO org_skills (name, description, content, published, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $5)
         ON CONFLICT (name) DO UPDATE SET
           description = EXCLUDED.description,
           content = EXCLUDED.content,
           published = EXCLUDED.published,
           updated_at = EXCLUDED.updated_at`,
        [name, description, input.content, published, now],
      );
      return (await this.findByNamePg(name))!;
    }

    this.db!
      .prepare(
        `INSERT INTO org_skills (name, description, content, published, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET
           description = excluded.description,
           content = excluded.content,
           published = excluded.published,
           updated_at = excluded.updated_at`,
      )
      .run(name, description, input.content, published ? 1 : 0, now, now);
    return (await this.findByNameAsync(name))!;
  }

  /** Returns true if a row was actually deleted. */
  async deleteAsync(name: string): Promise<boolean> {
    if (env.dbClient === 'postgres') {
      const r = await getPostgresPool().query(`DELETE FROM org_skills WHERE name = $1`, [name]);
      return (r.rowCount ?? 0) > 0;
    }
    const result = this.db!.prepare(`DELETE FROM org_skills WHERE name = ?`).run(name);
    return result.changes > 0;
  }
}
