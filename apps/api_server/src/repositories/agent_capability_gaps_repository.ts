/**
 * agent_capability_gaps_repository.ts — Stage A / Plan A↔Plan B shared contract (#983).
 *
 * A capability gap is recorded when the harvester distilled a reusable intent
 * but NO adequate skill exists in the owned library (skill_extractor step 3).
 * The next org-optimizer run (Plan B) reads open gaps and drives external
 * discovery, resolving a gap once it adopts and keeps a fix (on revert it
 * stays 'open').
 *
 * Dual-engine (#1113 — Discovery-005): every method branches on
 * `env.dbClient`. SQLite keeps the original synchronous better-sqlite3 calls
 * (with the constructor's throwaway `:memory:` fallback preserved ONLY for
 * "no global DB initialized" under SQLite, e.g. a unit test that never called
 * initDb()). Postgres queries `getPostgresPool()` directly — there is no
 * in-memory fallback for Postgres: before this fix, `getDb()` unconditionally
 * threw under Postgres (no local `_db`), so every instance silently fell back
 * to a throwaway in-memory SQLite DB and every gap vanished per-instance. See
 * docs/ai/current-plan.md #1113 and postgres_bootstrap.ts for the matching
 * `agent_capability_gaps` table.
 *
 * Async-named per this codebase's convention (AgentOrgProposalsRepository):
 * every public method returns a Promise, whether it wraps a synchronous
 * better-sqlite3 call (SQLite) or an actual async pg query (Postgres).
 */

import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'crypto';
import { env } from '../config/env';
import { getDb, getPostgresPool } from '../database/db';
import { runMigrations } from '../database/migrations';

/** Canonical model type (Plan B depends on this exact name and shape). */
export interface CapabilityGapRow {
  id: string;
  dedupKey: string;
  intentTitle: string;
  intentProblem: string | null;
  intentTags: string[] | null;
  sampleSessionId: string | null;
  agentConfigId: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface CapabilityGapInput {
  intentTitle: string;
  intentProblem?: string | null;
  intentTags?: string[] | null;
  sampleSessionId?: string | null;
  agentConfigId?: string | null;
}

/**
 * Raw DB row shape (snake_case) — internal only, never exported.
 * created_at/updated_at come back as a plain string from SQLite (TEXT) but
 * as a native Date from the `pg` driver (Postgres columns are TIMESTAMPTZ,
 * matching every other agent_* table in postgres_bootstrap.ts) — rowToModel
 * normalizes both to an ISO string.
 */
interface CapabilityGapDbRow {
  id: string;
  dedup_key: string;
  intent_title: string;
  intent_problem: string | null;
  intent_tags_json: string | null;
  sample_session_id: string | null;
  agent_config_id: string | null;
  status: string;
  created_at: string | Date;
  updated_at: string | Date;
}

function parseTags(raw: string | null): string[] | null {
  if (raw == null) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : null;
  } catch {
    return null;
  }
}

function toIso(value: string | Date): string {
  return typeof value === 'string' ? value : value.toISOString();
}

function rowToModel(row: CapabilityGapDbRow): CapabilityGapRow {
  return {
    id: row.id,
    dedupKey: row.dedup_key,
    intentTitle: row.intent_title,
    intentProblem: row.intent_problem ?? null,
    intentTags: parseTags(row.intent_tags_json),
    sampleSessionId: row.sample_session_id ?? null,
    agentConfigId: row.agent_config_id ?? null,
    status: row.status,
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

export class AgentCapabilityGapsRepository {
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

  /**
   * STABLE dedup key: sha256 over the normalized title + sorted, normalized
   * tags. NEVER incorporates time/uuid, so the same intent always hashes to
   * the same key and re-asks collapse onto one row via the UNIQUE constraint.
   * Tag order does not affect the result.
   */
  static dedupKeyFor(title: string, tags: string[] | null): string {
    const normTitle = (title ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
    const normTags = (tags ?? [])
      .map((t) => (typeof t === 'string' ? t.trim().toLowerCase() : ''))
      .filter((t) => t.length > 0)
      .sort();
    return createHash('sha256').update(`${normTitle}|${normTags.join(',')}`).digest('hex');
  }

  private findByDedupKeySync(dedupKey: string): CapabilityGapRow | null {
    const row = this.db!
      .prepare(`SELECT * FROM agent_capability_gaps WHERE dedup_key = ?`)
      .get(dedupKey) as CapabilityGapDbRow | undefined;
    return row ? rowToModel(row) : null;
  }

  private async findByDedupKeyPg(dedupKey: string): Promise<CapabilityGapRow | null> {
    const r = await getPostgresPool().query(
      `SELECT * FROM agent_capability_gaps WHERE dedup_key = $1`,
      [dedupKey],
    );
    return r.rows.length > 0 ? rowToModel(r.rows[0]) : null;
  }

  async findByDedupKeyAsync(dedupKey: string): Promise<CapabilityGapRow | null> {
    if (env.dbClient === 'postgres') return this.findByDedupKeyPg(dedupKey);
    return this.findByDedupKeySync(dedupKey);
  }

  async listOpenAsync(): Promise<CapabilityGapRow[]> {
    if (env.dbClient === 'postgres') {
      const r = await getPostgresPool().query(
        `SELECT * FROM agent_capability_gaps WHERE status = $1 ORDER BY created_at`,
        ['open'],
      );
      return r.rows.map(rowToModel);
    }
    const rows = this.db!
      .prepare(`SELECT * FROM agent_capability_gaps WHERE status = 'open' ORDER BY created_at`)
      .all() as CapabilityGapDbRow[];
    return rows.map(rowToModel);
  }

  /**
   * Insert a gap row if no row with the same dedup_key exists yet. Collapses
   * re-asks onto the same row via the UNIQUE dedup_key constraint: when a row
   * already exists it is returned UNCHANGED (never re-opened, never
   * overwritten) and `inserted` is false.
   */
  async insertIfAbsentAsync(
    input: CapabilityGapInput,
  ): Promise<{ inserted: boolean; gap: CapabilityGapRow }> {
    const dedupKey = AgentCapabilityGapsRepository.dedupKeyFor(
      input.intentTitle,
      input.intentTags ?? null,
    );
    const id = randomUUID();
    const now = new Date().toISOString();
    const tagsJson = input.intentTags != null ? JSON.stringify(input.intentTags) : null;

    if (env.dbClient === 'postgres') {
      const inserted = await getPostgresPool().query(
        `INSERT INTO agent_capability_gaps
           (id, dedup_key, intent_title, intent_problem, intent_tags_json,
            sample_session_id, agent_config_id, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'open', $8, $8)
         ON CONFLICT (dedup_key) DO NOTHING
         RETURNING *`,
        [
          id,
          dedupKey,
          input.intentTitle,
          input.intentProblem ?? null,
          tagsJson,
          input.sampleSessionId ?? null,
          input.agentConfigId ?? null,
          now,
        ],
      );
      if (inserted.rows.length > 0) {
        return { inserted: true, gap: rowToModel(inserted.rows[0]) };
      }
      // Conflict — a row with this dedup_key already existed. Re-select it.
      const gap = (await this.findByDedupKeyPg(dedupKey))!;
      return { inserted: false, gap };
    }

    const result = this.db!
      .prepare(
        `INSERT INTO agent_capability_gaps
           (id, dedup_key, intent_title, intent_problem, intent_tags_json,
            sample_session_id, agent_config_id, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)
         ON CONFLICT(dedup_key) DO NOTHING`,
      )
      .run(
        id,
        dedupKey,
        input.intentTitle,
        input.intentProblem ?? null,
        tagsJson,
        input.sampleSessionId ?? null,
        input.agentConfigId ?? null,
        now,
        now,
      );
    const gap = this.findByDedupKeySync(dedupKey)!;
    return { inserted: result.changes === 1, gap };
  }

  /**
   * Flip a gap to 'resolved' and bump updated_at (Plan B, on adopt+keep — on
   * revert the row is left untouched and stays 'open'). A no-op, never
   * throws, if dedupKey is unknown.
   */
  async resolveByDedupKeyAsync(dedupKey: string): Promise<void> {
    const now = new Date().toISOString();
    if (env.dbClient === 'postgres') {
      await getPostgresPool().query(
        `UPDATE agent_capability_gaps SET status = 'resolved', updated_at = $1 WHERE dedup_key = $2`,
        [now, dedupKey],
      );
      return;
    }
    this.db!
      .prepare(
        `UPDATE agent_capability_gaps SET status = 'resolved', updated_at = ? WHERE dedup_key = ?`,
      )
      .run(now, dedupKey);
  }
}
