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
  folderId: string | null;
  createdAt: string;
}

export interface AgentDesignFolder {
  id: string;
  name: string;
  sortOrder: number | null;
  createdAt: string;
  updatedAt: string;
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
const PREVIEWABLE_IMAGE_TYPES = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif']);

/**
 * Local file paths never leave the server; a local design instead points at the routes that serve
 * it (relative to the API base): /agent-designs/:id/artifact, and /thumbnail (poster) for mp4.
 */
export function publicAgentDesign(design: AgentDesign): Omit<AgentDesign, 'filePath'> {
  const { filePath, ...publicDesign } = design;
  if (!filePath) return publicDesign;
  const type = design.artifactType?.toLowerCase() ?? '';
  const artifactUrl = publicDesign.artifactUrl ?? `/agent-designs/${encodeURIComponent(design.id)}/artifact`;
  const thumbnailUrl = publicDesign.thumbnailUrl
    ?? (type === 'mp4' ? `/agent-designs/${encodeURIComponent(design.id)}/thumbnail`
      : PREVIEWABLE_IMAGE_TYPES.has(type) ? artifactUrl : null);
  return { ...publicDesign, artifactUrl, thumbnailUrl };
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
    folderId: (row.folder_id as string | null) ?? null,
    createdAt: isoTime(row.created_at),
  };
}

const isoTime = (value: unknown) => (typeof value === 'string' ? value : (value as Date).toISOString());

function rowToFolder(row: Record<string, unknown>): AgentDesignFolder {
  return {
    id: row.id as string,
    name: row.name as string,
    sortOrder: row.sort_order === null || row.sort_order === undefined ? null : Number(row.sort_order),
    createdAt: isoTime(row.created_at),
    updatedAt: isoTime(row.updated_at),
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

  /** Rename and/or move a design. `folderId: null` unfiles it; the folder must exist. */
  async updateAsync(id: string, patch: { title?: string; folderId?: string | null }): Promise<AgentDesign | null> {
    const sets: string[] = [];
    const values: unknown[] = [];
    if (patch.title !== undefined) { sets.push('title'); values.push(patch.title); }
    if (patch.folderId !== undefined) { sets.push('folder_id'); values.push(patch.folderId); }
    if (sets.length) {
      if (env.dbClient === 'postgres') {
        await getPostgresPool().query(
          `UPDATE agent_designs SET ${sets.map((column, index) => `${column} = $${index + 1}`).join(', ')} WHERE id = $${sets.length + 1}`,
          [...values, id],
        );
      } else {
        getDb().prepare(`UPDATE agent_designs SET ${sets.map((column) => `${column} = ?`).join(', ')} WHERE id = ?`).run(...values, id);
      }
    }
    return this.findByIdAsync(id);
  }

  async listFoldersAsync(): Promise<AgentDesignFolder[]> {
    const sql = `SELECT * FROM agent_design_folders ORDER BY sort_order ASC, name ASC`;
    if (env.dbClient === 'postgres') return (await getPostgresPool().query(sql)).rows.map(rowToFolder);
    return (getDb().prepare(sql).all() as Record<string, unknown>[]).map(rowToFolder);
  }

  async findFolderAsync(id: string): Promise<AgentDesignFolder | null> {
    if (env.dbClient === 'postgres') {
      const r = await getPostgresPool().query(`SELECT * FROM agent_design_folders WHERE id = $1`, [id]);
      return r.rows[0] ? rowToFolder(r.rows[0]) : null;
    }
    const row = getDb().prepare(`SELECT * FROM agent_design_folders WHERE id = ?`).get(id);
    return row ? rowToFolder(row as Record<string, unknown>) : null;
  }

  async createFolderAsync(name: string): Promise<AgentDesignFolder> {
    const id = randomUUID();
    const now = new Date().toISOString();
    // ponytail: append order by max+1; a concurrent create can tie, and ties sort by name.
    if (env.dbClient === 'postgres') {
      const r = await getPostgresPool().query(
        `INSERT INTO agent_design_folders (id, name, sort_order, created_at, updated_at)
           VALUES ($1, $2, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM agent_design_folders), $3, $3)
         RETURNING *`,
        [id, name, now],
      );
      return rowToFolder(r.rows[0]);
    }
    getDb().prepare(
      `INSERT INTO agent_design_folders (id, name, sort_order, created_at, updated_at)
         VALUES (?, ?, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM agent_design_folders), ?, ?)`,
    ).run(id, name, now, now);
    return (await this.findFolderAsync(id))!;
  }

  async renameFolderAsync(id: string, name: string): Promise<AgentDesignFolder | null> {
    const now = new Date().toISOString();
    if (env.dbClient === 'postgres') {
      await getPostgresPool().query(`UPDATE agent_design_folders SET name = $1, updated_at = $2 WHERE id = $3`, [name, now, id]);
    } else {
      getDb().prepare(`UPDATE agent_design_folders SET name = ?, updated_at = ? WHERE id = ?`).run(name, now, id);
    }
    return this.findFolderAsync(id);
  }

  /** Deletes the folder only; its designs move to Unfiled (never deleted). */
  async deleteFolderAsync(id: string): Promise<boolean> {
    if (env.dbClient === 'postgres') {
      // Unfile first: if the delete then fails, nothing is lost — the folder just stays empty.
      await getPostgresPool().query(`UPDATE agent_designs SET folder_id = NULL WHERE folder_id = $1`, [id]);
      const r = await getPostgresPool().query(`DELETE FROM agent_design_folders WHERE id = $1`, [id]);
      return (r.rowCount ?? 0) > 0;
    }
    const db = getDb();
    return db.transaction(() => {
      db.prepare(`UPDATE agent_designs SET folder_id = NULL WHERE folder_id = ?`).run(id);
      return db.prepare(`DELETE FROM agent_design_folders WHERE id = ?`).run(id).changes > 0;
    })();
  }
}
