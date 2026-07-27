import { randomUUID } from 'node:crypto';
import { getDb, getPostgresPool } from '../database/db';
import { env } from '../config/env';
import type {
  MemoryStatus,
  MemoryTrustTier,
} from '../services/memory_note_format';

export interface AgentMemory {
  id: string;
  kind: string;
  content: string;
  source: string | null;
  sourceId: string | null;
  tagsJson: string;
  status: MemoryStatus;
  staleAfter: string | null;
  verifiedJson: string;
  sourcesJson: string;
  generatedBy: string | null;
  generatedAt: string | null;
  trustTier: MemoryTrustTier;
  ownerUserId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAgentMemoryInput {
  kind?: string;
  content: string;
  source?: string;
  sourceId?: string;
  tagsJson?: string;
  ownerUserId?: number;
}

export interface MemorySearchOptions {
  /**
   * Automatic-injection-only lifecycle gate. Ordinary repository callers,
   * including explicit MCP recall, leave this false and see inactive rows.
   */
  activeOnly?: boolean;
  /** YYYY-MM-DD boundary captured at retrieval call time. */
  today?: string;
}

function rowToModel(row: Record<string, unknown>): AgentMemory {
  return {
    id: row.id as string,
    kind: (row.kind as string) ?? 'fact',
    content: row.content as string,
    source: (row.source as string | null) ?? null,
    sourceId: (row.source_id as string | null) ?? null,
    tagsJson: (row.tags_json as string) ?? '[]',
    status: (row.status as MemoryStatus) ?? 'stable',
    staleAfter: (row.stale_after as string | null) ?? null,
    verifiedJson: (row.verified_json as string) ?? '[]',
    sourcesJson: (row.sources_json as string) ?? '[]',
    generatedBy: (row.generated_by as string | null) ?? null,
    generatedAt: (row.generated_at as string | null) ?? null,
    trustTier: (row.trust_tier as MemoryTrustTier) ?? 'unverified',
    ownerUserId: (row.owner_user_id as number | null) ?? null,
    createdAt:
      typeof row.created_at === 'string'
        ? row.created_at
        : (row.created_at as Date).toISOString(),
    updatedAt:
      typeof row.updated_at === 'string'
        ? row.updated_at
        : (row.updated_at as Date).toISOString(),
  };
}

export class AgentMemoryRepository {
  async createAsync(input: CreateAgentMemoryInput): Promise<AgentMemory> {
    const id = randomUUID();
    const now = new Date().toISOString();

    if (env.dbClient === 'postgres') {
      const r = await getPostgresPool().query(
        `INSERT INTO agent_memory
           (id, kind, content, source, source_id, tags_json, owner_user_id, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id, kind, content, source, source_id, tags_json, owner_user_id, created_at, updated_at`,
        [
          id, input.kind ?? 'fact', input.content,
          input.source ?? null, input.sourceId ?? null,
          input.tagsJson ?? '[]', input.ownerUserId ?? null, now, now,
        ],
      );
      return rowToModel(r.rows[0]);
    }

    getDb().prepare(`
      INSERT INTO agent_memory
        (id, kind, content, source, source_id, tags_json, owner_user_id, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(
      id, input.kind ?? 'fact', input.content,
      input.source ?? null, input.sourceId ?? null,
      input.tagsJson ?? '[]', input.ownerUserId ?? null, now, now,
    );

    // Sync FTS index
    try {
      const row = getDb().prepare(`SELECT rowid FROM agent_memory WHERE id = ?`).get(id) as { rowid: number } | undefined;
      if (row) {
        getDb().prepare(`INSERT INTO agent_memory_fts(rowid, content, kind, tags_json) VALUES (?,?,?,?)`).run(
          row.rowid, input.content, input.kind ?? 'fact', input.tagsJson ?? '[]',
        );
      }
    } catch {
      // FTS table may not exist on older DBs — non-fatal
    }

    return (await this.findByIdAsync(id))!;
  }

  async findByIdAsync(id: string): Promise<AgentMemory | null> {
    if (env.dbClient === 'postgres') {
      const r = await getPostgresPool().query(
        `SELECT id, kind, content, source, source_id, tags_json, owner_user_id, created_at, updated_at FROM agent_memory WHERE id = $1`,
        [id],
      );
      return r.rows.length > 0 ? rowToModel(r.rows[0]) : null;
    }
    const row = getDb().prepare(`
      SELECT id, kind, content, source, source_id, tags_json,
             status, stale_after, verified_json, sources_json,
             generated_by, generated_at, trust_tier,
             owner_user_id, created_at, updated_at
      FROM agent_memory WHERE id = ?
    `).get(id);
    return row ? rowToModel(row as Record<string, unknown>) : null;
  }

  async searchAsync(
    query: string,
    ownerUserId?: number,
    limit = 20,
    options: MemorySearchOptions = {},
  ): Promise<AgentMemory[]> {
    if (env.dbClient === 'postgres') {
      const params: unknown[] = [query];
      const ownerFilter = ownerUserId != null ? `AND owner_user_id = $2` : '';
      if (ownerUserId != null) params.push(ownerUserId);
      params.push(limit);
      const r = await getPostgresPool().query(
        `SELECT id, kind, content, source, source_id, tags_json, owner_user_id, created_at, updated_at,
                ts_rank(search_vector, plainto_tsquery('english', $1)) AS rank
         FROM agent_memory
         WHERE search_vector @@ plainto_tsquery('english', $1) ${ownerFilter}
         ORDER BY rank DESC
         LIMIT $${params.length}`,
        params,
      );
      return r.rows.map(rowToModel);
    }

    // SQLite: try FTS5 first, fall back to LIKE
    try {
      const ownerFilter = ownerUserId != null ? 'AND m.owner_user_id = ?' : '';
      const activeFilter = options.activeOnly
        ? `AND m.status != 'deprecated'
           AND (m.stale_after IS NULL OR m.stale_after > ?)`
        : '';
      const params: unknown[] = [query];
      if (ownerUserId != null) params.push(ownerUserId);
      if (options.activeOnly) {
        params.push(options.today ?? new Date().toISOString().slice(0, 10));
      }
      params.push(limit);
      const rows = getDb().prepare(`
        SELECT m.id, m.kind, m.content, m.source, m.source_id, m.tags_json,
               m.status, m.stale_after, m.verified_json, m.sources_json,
               m.generated_by, m.generated_at, m.trust_tier,
               m.owner_user_id, m.created_at, m.updated_at
        FROM agent_memory m
        JOIN agent_memory_fts f ON m.rowid = f.rowid
        WHERE agent_memory_fts MATCH ? ${ownerFilter} ${activeFilter}
        ORDER BY rank
        LIMIT ?
      `).all(...params);
      return (rows as Record<string, unknown>[]).map(rowToModel);
    } catch {
      // FTS unavailable — fall back to LIKE
      const likeQuery = `%${query}%`;
      const ownerFilter = ownerUserId != null ? 'AND owner_user_id = ?' : '';
      const activeFilter = options.activeOnly
        ? `AND status != 'deprecated'
           AND (stale_after IS NULL OR stale_after > ?)`
        : '';
      const params: unknown[] = [likeQuery];
      if (ownerUserId != null) params.push(ownerUserId);
      if (options.activeOnly) {
        params.push(options.today ?? new Date().toISOString().slice(0, 10));
      }
      params.push(limit);
      const rows = getDb().prepare(
        `SELECT id, kind, content, source, source_id, tags_json,
                status, stale_after, verified_json, sources_json,
                generated_by, generated_at, trust_tier,
                owner_user_id, created_at, updated_at
         FROM agent_memory
         WHERE content LIKE ? ${ownerFilter} ${activeFilter}
         LIMIT ?`,
      ).all(...params);
      return (rows as Record<string, unknown>[]).map(rowToModel);
    }
  }

  /** Exact, owner-scoped lookup for trusted vault source ids (Engraph join). */
  async findBySourceIdsAsync(source: string, sourceIds: string[], ownerUserId?: number): Promise<AgentMemory[]> {
    if (sourceIds.length === 0) return [];
    if (env.dbClient === 'postgres') {
      const params: unknown[] = [source, sourceIds];
      const ownerFilter = ownerUserId != null ? `AND owner_user_id = $3` : 'AND owner_user_id IS NULL';
      if (ownerUserId != null) params.push(ownerUserId);
      const r = await getPostgresPool().query(
        `SELECT id, kind, content, source, source_id, tags_json, owner_user_id, created_at, updated_at
         FROM agent_memory WHERE source = $1 AND source_id = ANY($2::text[]) ${ownerFilter}`,
        params,
      );
      return r.rows.map(rowToModel);
    }

    const placeholders = sourceIds.map(() => '?').join(',');
    const ownerFilter = ownerUserId != null ? 'AND owner_user_id = ?' : 'AND owner_user_id IS NULL';
    const params: unknown[] = [source, ...sourceIds];
    if (ownerUserId != null) params.push(ownerUserId);
    const rows = getDb().prepare(
      `SELECT id, kind, content, source, source_id, tags_json,
              status, stale_after, verified_json, sources_json,
              generated_by, generated_at, trust_tier,
              owner_user_id, created_at, updated_at
       FROM agent_memory WHERE source = ? AND source_id IN (${placeholders}) ${ownerFilter}`,
    ).all(...params);
    return (rows as Record<string, unknown>[]).map(rowToModel);
  }

  async listAsync(ownerUserId?: number, kind?: string, limit = 50): Promise<AgentMemory[]> {
    if (env.dbClient === 'postgres') {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (ownerUserId != null) { conditions.push(`owner_user_id = $${params.length + 1}`); params.push(ownerUserId); }
      if (kind) { conditions.push(`kind = $${params.length + 1}`); params.push(kind); }
      params.push(limit);
      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const r = await getPostgresPool().query(
        `SELECT id, kind, content, source, source_id, tags_json, owner_user_id, created_at, updated_at
         FROM agent_memory ${where} ORDER BY created_at DESC LIMIT $${params.length}`,
        params,
      );
      return r.rows.map(rowToModel);
    }

    const conditions: string[] = [];
    const params: unknown[] = [];
    if (ownerUserId != null) { conditions.push('owner_user_id = ?'); params.push(ownerUserId); }
    if (kind) { conditions.push('kind = ?'); params.push(kind); }
    params.push(limit);
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = getDb().prepare(
      `SELECT id, kind, content, source, source_id, tags_json,
              status, stale_after, verified_json, sources_json,
              generated_by, generated_at, trust_tier,
              owner_user_id, created_at, updated_at
       FROM agent_memory ${where} ORDER BY created_at DESC LIMIT ?`,
    ).all(...params);
    return (rows as Record<string, unknown>[]).map(rowToModel);
  }

  /**
   * Issue #770 WI6 — mirror-sync upsert keyed on (source, source_id).
   *
   * Idempotent: if a row with the same (source, source_id) already exists it is
   * UPDATED in place (preserving its id and created_at); otherwise a new row is
   * inserted. Returns `true` when a new row was inserted, `false` when an
   * existing row was updated (lets callers count net upserts vs. touches if
   * needed — both count as "upserted" for the sync summary).
   *
   * Keeps the SQLite FTS5 index in sync on both paths.
   */
  async upsertBySourceAsync(input: {
    kind: string;
    content: string;
    source: string;
    sourceId: string;
    tagsJson: string;
    status?: MemoryStatus;
    staleAfter?: string | null;
    verifiedJson?: string;
    sourcesJson?: string;
    generatedBy?: string | null;
    generatedAt?: string | null;
    trustTier?: MemoryTrustTier;
    ownerUserId?: number | null;
  }): Promise<boolean> {
    const now = new Date().toISOString();

    if (env.dbClient === 'postgres') {
      const existing = await getPostgresPool().query(
        `SELECT id FROM agent_memory WHERE source = $1 AND source_id = $2 LIMIT 1`,
        [input.source, input.sourceId],
      );
      if (existing.rows.length > 0) {
        await getPostgresPool().query(
          `UPDATE agent_memory
             SET kind = $1, content = $2, tags_json = $3, updated_at = $4
           WHERE id = $5`,
          [input.kind, input.content, input.tagsJson, now, existing.rows[0].id],
        );
        return false;
      }
      const id = randomUUID();
      await getPostgresPool().query(
        `INSERT INTO agent_memory
           (id, kind, content, source, source_id, tags_json, owner_user_id, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          id, input.kind, input.content, input.source, input.sourceId,
          input.tagsJson, input.ownerUserId ?? null, now, now,
        ],
      );
      return true;
    }

    const existing = getDb()
      .prepare(`SELECT rowid, id, content, kind, tags_json FROM agent_memory WHERE source = ? AND source_id = ? LIMIT 1`)
      .get(input.source, input.sourceId) as
        | { rowid: number; id: string; content: string; kind: string; tags_json: string }
        | undefined;

    if (existing) {
      // External-content FTS5 requires the OLD column values to delete the
      // index entry; read them BEFORE updating the base row.
      this._ftsDelete(existing.rowid, existing.content, existing.kind, existing.tags_json);
      getDb().prepare(`
        UPDATE agent_memory
           SET kind = ?, content = ?, tags_json = ?,
               status = ?, stale_after = ?, verified_json = ?, sources_json = ?,
               generated_by = ?, generated_at = ?, trust_tier = ?,
               updated_at = ?
         WHERE id = ?
      `).run(
        input.kind,
        input.content,
        input.tagsJson,
        input.status ?? 'stable',
        input.staleAfter ?? null,
        input.verifiedJson ?? '[]',
        input.sourcesJson ?? '[]',
        input.generatedBy ?? null,
        input.generatedAt ?? null,
        input.trustTier ?? 'unverified',
        now,
        existing.id,
      );
      this._ftsInsert(existing.rowid, input.content, input.kind, input.tagsJson);
      return false;
    }

    const id = randomUUID();
    getDb().prepare(`
      INSERT INTO agent_memory
        (id, kind, content, source, source_id, tags_json,
         status, stale_after, verified_json, sources_json,
         generated_by, generated_at, trust_tier,
         owner_user_id, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      id, input.kind, input.content, input.source, input.sourceId,
      input.tagsJson,
      input.status ?? 'stable',
      input.staleAfter ?? null,
      input.verifiedJson ?? '[]',
      input.sourcesJson ?? '[]',
      input.generatedBy ?? null,
      input.generatedAt ?? null,
      input.trustTier ?? 'unverified',
      input.ownerUserId ?? null,
      now,
      now,
    );
    const inserted = getDb()
      .prepare(`SELECT rowid FROM agent_memory WHERE id = ?`)
      .get(id) as { rowid: number } | undefined;
    if (inserted) {
      this._ftsInsert(inserted.rowid, input.content, input.kind, input.tagsJson);
    }
    return true;
  }

  /** List the distinct source_id values currently stored for a given source. */
  async listSourceIdsBySourceAsync(source: string): Promise<string[]> {
    if (env.dbClient === 'postgres') {
      const r = await getPostgresPool().query(
        `SELECT source_id FROM agent_memory WHERE source = $1 AND source_id IS NOT NULL`,
        [source],
      );
      return r.rows.map((row) => row.source_id as string);
    }
    const rows = getDb()
      .prepare(`SELECT source_id FROM agent_memory WHERE source = ? AND source_id IS NOT NULL`)
      .all(source) as { source_id: string }[];
    return rows.map((row) => row.source_id);
  }

  /**
   * Tombstone cleanup: delete rows for a given source whose source_id is in the
   * supplied list. Returns the number of rows deleted. Keeps FTS in sync.
   */
  async deleteBySourceAndSourceIdsAsync(source: string, sourceIds: string[]): Promise<number> {
    if (sourceIds.length === 0) return 0;

    if (env.dbClient === 'postgres') {
      const r = await getPostgresPool().query(
        `DELETE FROM agent_memory WHERE source = $1 AND source_id = ANY($2::text[])`,
        [source, sourceIds],
      );
      return r.rowCount ?? 0;
    }

    let deleted = 0;
    const selectStmt = getDb().prepare(
      `SELECT id, rowid, content, kind, tags_json FROM agent_memory WHERE source = ? AND source_id = ?`,
    );
    const deleteStmt = getDb().prepare(`DELETE FROM agent_memory WHERE id = ?`);
    for (const sourceId of sourceIds) {
      const row = selectStmt.get(source, sourceId) as
        | { id: string; rowid: number; content: string; kind: string; tags_json: string }
        | undefined;
      if (!row) continue;
      this._ftsDelete(row.rowid, row.content, row.kind, row.tags_json);
      const r = deleteStmt.run(row.id);
      deleted += r.changes;
    }
    return deleted;
  }

  /**
   * Issue #802 — wipe the entire local SQLite index in one shot.
   *
   * The SQLite `agent_memory` + `agent_memory_fts` store is a DERIVED,
   * DISPOSABLE cache that MemoryIndexService rebuilds from a full vault scan,
   * so a total clear is a legitimate operation. Returns the number of rows
   * removed. Keeps the FTS index consistent by rebuilding it from the (now
   * empty) base table.
   *
   * SQLite-only: the index lives only in SQLite. On Postgres this is a no-op
   * (returns 0). #807 removed the prod/Postgres `agent_memory` store entirely —
   * agent memory is local-vault/SQLite-only now — so the Postgres branches in
   * this repository are inert dead paths the local agent server never reaches.
   */
  async clearAllAsync(): Promise<number> {
    if (env.dbClient === 'postgres') return 0;

    const countRow = getDb().prepare(`SELECT COUNT(*) AS n FROM agent_memory`).get() as
      | { n: number }
      | undefined;
    const before = countRow?.n ?? 0;

    getDb().prepare(`DELETE FROM agent_memory`).run();
    // External-content FTS5: the special 'delete-all' command empties the index
    // without needing each row's old column values.
    try {
      getDb().prepare(`INSERT INTO agent_memory_fts(agent_memory_fts) VALUES ('delete-all')`).run();
    } catch {
      // FTS table may not exist on older DBs — non-fatal.
    }
    return before;
  }

  /**
   * SQLite-only helper: insert an FTS5 index row. External-content FTS5
   * (content='agent_memory') tolerates a plain INSERT with explicit columns.
   */
  private _ftsInsert(rowid: number, content: string, kind: string, tagsJson: string): void {
    try {
      getDb()
        .prepare(`INSERT INTO agent_memory_fts(rowid, content, kind, tags_json) VALUES (?,?,?,?)`)
        .run(rowid, content, kind, tagsJson);
    } catch {
      // FTS table may not exist on older DBs — non-fatal
    }
  }

  /**
   * SQLite-only helper: remove an FTS5 index row. External-content FTS5 does
   * NOT support a plain `DELETE FROM ... WHERE rowid = ?` (it corrupts the
   * index — SQLITE_CORRUPT_VTAB). The supported form is the special 'delete'
   * command, which requires the OLD column values that were indexed.
   */
  private _ftsDelete(rowid: number, content: string, kind: string, tagsJson: string): void {
    try {
      getDb()
        .prepare(
          `INSERT INTO agent_memory_fts(agent_memory_fts, rowid, content, kind, tags_json) VALUES ('delete', ?, ?, ?, ?)`,
        )
        .run(rowid, content, kind, tagsJson);
    } catch {
      // FTS table may not exist on older DBs — non-fatal
    }
  }

  async deleteAsync(id: string): Promise<boolean> {
    if (env.dbClient === 'postgres') {
      const r = await getPostgresPool().query(`DELETE FROM agent_memory WHERE id = $1`, [id]);
      return (r.rowCount ?? 0) > 0;
    }
    const row = getDb().prepare(`SELECT rowid FROM agent_memory WHERE id = ?`).get(id) as { rowid: number } | undefined;
    if (row) {
      try { getDb().prepare(`DELETE FROM agent_memory_fts WHERE rowid = ?`).run(row.rowid); } catch { /* FTS may not exist */ }
    }
    const r = getDb().prepare(`DELETE FROM agent_memory WHERE id = ?`).run(id);
    return r.changes > 0;
  }
}
