import { randomUUID } from 'node:crypto';
import { getDb, getPostgresPool } from '../database/db';
import { env } from '../config/env';

export interface AgentDesign {
  id: string;
  title: string | null;
  provider: string | null;
  artifactUrl: string | null;
  projectUrl: string | null;
  canvaUrl: string | null;
  artifactType: string | null;
  filePath: string | null;
  thumbnailUrl: string | null;
  sessionId: string | null;
  createdAt: string;
}

export interface CreateAgentDesignInput {
  title?: string;
  provider?: string;
  artifactUrl?: string;
  projectUrl?: string;
  canvaUrl?: string;
  artifactType?: string;
  filePath?: string;
  thumbnailUrl?: string;
  sessionId?: string;
}

/** Never serialize local filesystem locations to API clients. */
export function publicAgentDesign(design: AgentDesign): Omit<AgentDesign, 'filePath'> {
  const { filePath: _filePath, ...publicDesign } = design;
  return publicDesign;
}

function rowToModel(row: Record<string, unknown>): AgentDesign {
  return {
    id: row.id as string,
    title: (row.title as string | null) ?? null,
    provider: (row.provider as string | null) ?? null,
    artifactUrl: (row.artifact_url as string | null) ?? null,
    projectUrl: (row.project_url as string | null) ?? (row.canva_url as string | null) ?? null,
    canvaUrl: (row.canva_url as string | null) ?? null,
    artifactType: (row.artifact_type as string | null) ?? null,
    filePath: (row.file_path as string | null) ?? null,
    thumbnailUrl: (row.thumbnail_url as string | null) ?? null,
    sessionId: (row.session_id as string | null) ?? null,
    createdAt:
      typeof row.created_at === 'string'
        ? row.created_at
        : (row.created_at as Date).toISOString(),
  };
}

export class AgentDesignsRepository {
  async createAsync(input: CreateAgentDesignInput): Promise<AgentDesign> {
    const id = randomUUID();
    const now = new Date().toISOString();

    if (env.dbClient === 'postgres') {
      const r = await getPostgresPool().query(
        `INSERT INTO agent_designs
           (id, title, provider, artifact_url, project_url, canva_url, artifact_type, file_path, thumbnail_url, session_id, created_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING *`,
        [
          id,
          input.title ?? null,
          input.provider ?? null,
          input.artifactUrl ?? null,
          input.projectUrl ?? null,
          input.canvaUrl ?? (input.provider === 'canva' ? input.projectUrl ?? null : null),
          input.artifactType ?? null,
          input.filePath ?? null,
          input.thumbnailUrl ?? null,
          input.sessionId ?? null,
          now,
        ],
      );
      return rowToModel(r.rows[0]);
    }

    getDb()
      .prepare(
        `INSERT INTO agent_designs
           (id, title, provider, artifact_url, project_url, canva_url, artifact_type, file_path, thumbnail_url, session_id, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        input.title ?? null,
        input.provider ?? null,
        input.artifactUrl ?? null,
        input.projectUrl ?? null,
        input.canvaUrl ?? (input.provider === 'canva' ? input.projectUrl ?? null : null),
        input.artifactType ?? null,
        input.filePath ?? null,
        input.thumbnailUrl ?? null,
        input.sessionId ?? null,
        now,
      );

    return this.findByIdAsync(id) as Promise<AgentDesign>;
  }

  async findByIdAsync(id: string): Promise<AgentDesign | null> {
    if (env.dbClient === 'postgres') {
      const r = await getPostgresPool().query(
        `SELECT * FROM agent_designs WHERE id = $1`,
        [id],
      );
      return r.rows.length > 0 ? rowToModel(r.rows[0]) : null;
    }
    const row = getDb()
      .prepare(`SELECT * FROM agent_designs WHERE id = ?`)
      .get(id);
    return row ? rowToModel(row as Record<string, unknown>) : null;
  }

  async listAllAsync(): Promise<AgentDesign[]> {
    if (env.dbClient === 'postgres') {
      const r = await getPostgresPool().query(
        `SELECT * FROM agent_designs ORDER BY created_at DESC`,
      );
      return r.rows.map(rowToModel);
    }
    const rows = getDb()
      .prepare(`SELECT * FROM agent_designs ORDER BY created_at DESC`)
      .all();
    return (rows as Record<string, unknown>[]).map(rowToModel);
  }

  async deleteAsync(id: string): Promise<boolean> {
    if (env.dbClient === 'postgres') {
      const r = await getPostgresPool().query(
        `DELETE FROM agent_designs WHERE id = $1`,
        [id],
      );
      return (r.rowCount ?? 0) > 0;
    }
    const r = getDb()
      .prepare(`DELETE FROM agent_designs WHERE id = ?`)
      .run(id);
    return r.changes > 0;
  }
}
