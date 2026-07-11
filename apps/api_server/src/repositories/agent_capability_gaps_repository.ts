/**
 * agent_capability_gaps_repository.ts — Stage A / Plan A↔Plan B shared contract (#983).
 *
 * A capability gap is recorded when the harvester distilled a reusable intent
 * but NO adequate skill exists in the owned library (skill_extractor step 3).
 * The next org-optimizer run (Plan B) reads open gaps and drives external
 * discovery, resolving a gap once it adopts and keeps a fix (on revert it
 * stays 'open').
 *
 * Local-SQLite-only. Async-named per this codebase's convention
 * (AgentOrgProposalsRepository): every public method wraps a synchronous
 * better-sqlite3 call in a Promise-returning `*Async` method. The constructor
 * mirrors AgentOrgProposalsRepository's guard — when no global DB is
 * initialized (including the Postgres path, where `getDb()` throws because
 * there is no local SQLite instance), fall back to a throwaway in-memory DB
 * instead of crashing.
 */

import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'crypto';
import { getDb } from '../database/db';
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

/** Raw SQLite row shape (snake_case) — internal only, never exported. */
interface CapabilityGapDbRow {
  id: string;
  dedup_key: string;
  intent_title: string;
  intent_problem: string | null;
  intent_tags_json: string | null;
  sample_session_id: string | null;
  agent_config_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function makeInMemoryDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

export class AgentCapabilityGapsRepository {
  private db: Database.Database;

  constructor(db?: Database.Database) {
    if (db) {
      this.db = db;
    } else {
      try {
        this.db = getDb();
      } catch {
        // No global DB initialized (or running against Postgres, which has no
        // local table for this) — create a throwaway in-memory instance.
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
    const row = this.db
      .prepare(`SELECT * FROM agent_capability_gaps WHERE dedup_key = ?`)
      .get(dedupKey) as CapabilityGapDbRow | undefined;
    return row ? rowToModel(row) : null;
  }

  async findByDedupKeyAsync(dedupKey: string): Promise<CapabilityGapRow | null> {
    return this.findByDedupKeySync(dedupKey);
  }

  async listOpenAsync(): Promise<CapabilityGapRow[]> {
    const rows = this.db
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
    const result = this.db
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
        input.intentTags != null ? JSON.stringify(input.intentTags) : null,
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
    this.db
      .prepare(
        `UPDATE agent_capability_gaps SET status = 'resolved', updated_at = ? WHERE dedup_key = ?`,
      )
      .run(new Date().toISOString(), dedupKey);
  }
}
