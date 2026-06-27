import { randomUUID } from 'node:crypto';
import { getDb, getPostgresPool } from '../database/db';
import { env } from '../config/env';

export interface AgentMemory {
  id: string;
  kind: string;
  content: string;
  source: string | null;
  sourceId: string | null;
  tagsJson: string;
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

function rowToModel(row: Record<string, unknown>): AgentMemory {
  return {
    id: row.id as string,
    kind: (row.kind as string) ?? 'fact',
    content: row.content as string,
    source: (row.source as string | null) ?? null,
    sourceId: (row.source_id as string | null) ?? null,
    tagsJson: (row.tags_json as string) ?? '[]',
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
    const row = getDb().prepare(`SELECT id, kind, content, source, source_id, tags_json, owner_user_id, created_at, updated_at FROM agent_memory WHERE id = ?`).get(id);
    return row ? rowToModel(row as Record<string, unknown>) : null;
  }

  async searchAsync(query: string, ownerUserId?: number, limit = 20): Promise<AgentMemory[]> {
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
      const params: unknown[] = [query];
      if (ownerUserId != null) params.push(ownerUserId);
      params.push(limit);
      const rows = getDb().prepare(`
        SELECT m.id, m.kind, m.content, m.source, m.source_id, m.tags_json, m.owner_user_id, m.created_at, m.updated_at
        FROM agent_memory m
        JOIN agent_memory_fts f ON m.rowid = f.rowid
        WHERE agent_memory_fts MATCH ? ${ownerFilter}
        ORDER BY rank
        LIMIT ?
      `).all(...params);
      return (rows as Record<string, unknown>[]).map(rowToModel);
    } catch {
      // FTS unavailable — fall back to LIKE
      const likeQuery = `%${query}%`;
      const ownerFilter = ownerUserId != null ? 'AND owner_user_id = ?' : '';
      const params: unknown[] = [likeQuery];
      if (ownerUserId != null) params.push(ownerUserId);
      params.push(limit);
      const rows = getDb().prepare(
        `SELECT id, kind, content, source, source_id, tags_json, owner_user_id, created_at, updated_at
         FROM agent_memory WHERE content LIKE ? ${ownerFilter} LIMIT ?`,
      ).all(...params);
      return (rows as Record<string, unknown>[]).map(rowToModel);
    }
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
      `SELECT id, kind, content, source, source_id, tags_json, owner_user_id, created_at, updated_at
       FROM agent_memory ${where} ORDER BY created_at DESC LIMIT ?`,
    ).all(...params);
    return (rows as Record<string, unknown>[]).map(rowToModel);
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
