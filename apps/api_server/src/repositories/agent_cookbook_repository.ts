import { randomUUID } from 'node:crypto';
import { getDb, getPostgresPool } from '../database/db';
import { env } from '../config/env';

export interface AgentCookbook {
  id: string;
  title: string;
  description: string | null;
  stepsJson: string;
  boundConfigId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAgentCookbookInput {
  title: string;
  description?: string;
  stepsJson?: string;
  boundConfigId?: string;
  /** Server-derived owner. NULL is reserved for trusted local/system recipes. */
  ownerUserId?: number | null;
}

function rowToModel(row: Record<string, unknown>): AgentCookbook {
  return {
    id: row.id as string,
    title: row.title as string,
    description: (row.description as string | null) ?? null,
    stepsJson: (row.steps_json as string) ?? '[]',
    boundConfigId: (row.bound_config_id as string | null) ?? null,
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

export class AgentCookbookRepository {
  async createAsync(input: CreateAgentCookbookInput): Promise<AgentCookbook> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const stepsJson = input.stepsJson ?? '[]';

    if (env.dbClient === 'postgres') {
      const r = await getPostgresPool().query(
        `INSERT INTO agent_cookbook
           (id, title, description, steps_json, bound_config_id, owner_user_id,
            created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING *`,
        [
          id,
          input.title,
          input.description ?? null,
          stepsJson,
          input.boundConfigId ?? null,
          input.ownerUserId ?? null,
          now,
          now,
        ],
      );
      return rowToModel(r.rows[0]);
    }

    getDb()
      .prepare(
        `INSERT INTO agent_cookbook
           (id, title, description, steps_json, bound_config_id, owner_user_id,
            created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        input.title,
        input.description ?? null,
        stepsJson,
        input.boundConfigId ?? null,
        input.ownerUserId ?? null,
        now,
        now,
      );

    return this.findByIdAsync(id) as Promise<AgentCookbook>;
  }

  async findByIdAsync(id: string): Promise<AgentCookbook | null> {
    if (env.dbClient === 'postgres') {
      const r = await getPostgresPool().query(
        `SELECT * FROM agent_cookbook WHERE id = $1`,
        [id],
      );
      return r.rows.length > 0 ? rowToModel(r.rows[0]) : null;
    }
    const row = getDb()
      .prepare(`SELECT * FROM agent_cookbook WHERE id = ?`)
      .get(id);
    return row ? rowToModel(row as Record<string, unknown>) : null;
  }

  async listAllAsync(): Promise<AgentCookbook[]> {
    if (env.dbClient === 'postgres') {
      const r = await getPostgresPool().query(
        `SELECT * FROM agent_cookbook ORDER BY created_at DESC`,
      );
      return r.rows.map(rowToModel);
    }
    const rows = getDb()
      .prepare(`SELECT * FROM agent_cookbook ORDER BY created_at DESC`)
      .all();
    return (rows as Record<string, unknown>[]).map(rowToModel);
  }

  async updateAsync(
    id: string,
    patch: Partial<CreateAgentCookbookInput>,
  ): Promise<AgentCookbook | null> {
    const now = new Date().toISOString();
    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    const map: Record<string, string> = {
      title: 'title',
      description: 'description',
      stepsJson: 'steps_json',
      boundConfigId: 'bound_config_id',
    };

    for (const [k, col] of Object.entries(map)) {
      if (k in patch) {
        fields.push(
          env.dbClient === 'postgres' ? `${col} = $${i++}` : `${col} = ?`,
        );
        values.push((patch as Record<string, unknown>)[k] ?? null);
      }
    }
    if (fields.length === 0) return this.findByIdAsync(id);

    fields.push(
      env.dbClient === 'postgres' ? `updated_at = $${i++}` : `updated_at = ?`,
    );
    values.push(now);

    if (env.dbClient === 'postgres') {
      values.push(id);
      await getPostgresPool().query(
        `UPDATE agent_cookbook SET ${fields.join(', ')} WHERE id = $${i}`,
        values,
      );
    } else {
      values.push(id);
      getDb()
        .prepare(
          `UPDATE agent_cookbook SET ${fields.join(', ')} WHERE id = ?`,
        )
        .run(...values);
    }

    return this.findByIdAsync(id);
  }

  async deleteAsync(id: string): Promise<boolean> {
    if (env.dbClient === 'postgres') {
      const r = await getPostgresPool().query(
        `DELETE FROM agent_cookbook WHERE id = $1`,
        [id],
      );
      return (r.rowCount ?? 0) > 0;
    }
    const r = getDb()
      .prepare(`DELETE FROM agent_cookbook WHERE id = ?`)
      .run(id);
    return r.changes > 0;
  }
}
