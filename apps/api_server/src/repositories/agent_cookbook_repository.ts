import { randomUUID } from 'node:crypto';
import { getDb, getPostgresPool } from '../database/db';
import { env } from '../config/env';
import { validateRecipeWorkflowV1 } from '../contracts/recipe_workflow_contract';

export type AgentCookbookFormat = 'legacy' | 'v1';

export interface AgentCookbook {
  id: string;
  title: string;
  description: string | null;
  stepsJson: string;
  boundConfigId: string | null;
  ownerUserId: number | null;
  createdAt: string;
  updatedAt: string;
  /** #1485 S1a — additive, nullable. NULL on every row until S3a workflow create ships. */
  schemaVersion: number | null;
  /** #1485 S1a — additive, nullable. NULL means legacy prompt recipe. */
  definitionJson: string | null;
  /**
   * #1485 S1a/S3a-1 — derived, never stored: 'legacy' when definitionJson is
   * NULL; 'v1' when schema_version === 1 AND definitionJson parses and
   * validates cleanly against {@link validateRecipeWorkflowV1}. Anything else
   * present-but-invalid (wrong version, malformed JSON, failed validation)
   * reports 'legacy' rather than a new state — `explicit_upgrade_required` is
   * intentionally withheld until S5 ships a real conversion path
   * (docs/ai/current-plan-recipes-1485.md "Persistence and compatibility");
   * exposing it earlier would be an alarming dead end with no way to act on
   * it, and workflow create/update is expected to validate BEFORE persisting
   * (see {@link CreateAgentCookbookInput.definitionJson}), so an invalid
   * stored definition should not occur outside a corrupted row.
   */
  format: AgentCookbookFormat;
}

export interface CreateAgentCookbookInput {
  title: string;
  description?: string;
  stepsJson?: string;
  boundConfigId?: string;
  /** Server-derived owner. NULL is reserved for trusted local/system recipes. */
  ownerUserId?: number | null;
  /** #1485 S3a-1 — always 1 when definitionJson is provided. */
  schemaVersion?: number | null;
  /**
   * #1485 S3a-1 — a v1 RecipeWorkflowDefinitionV1 JSON string. Callers are
   * responsible for validating with {@link validateRecipeWorkflowV1} before
   * calling create/update; this repository does not re-validate on write (it
   * only derives read-time `format`), matching the plan's "workflow
   * create/update validates before persistence" without duplicating that
   * check in every call path (there is exactly one recipe_workflow_runner.ts
   * caller today).
   */
  definitionJson?: string | null;
}

/** #1485 S3a-1 — see {@link AgentCookbook.format}. */
function deriveFormat(schemaVersion: number | null, definitionJson: string | null): AgentCookbookFormat {
  if (definitionJson == null || schemaVersion !== 1) return 'legacy';
  try {
    return validateRecipeWorkflowV1(JSON.parse(definitionJson)).valid ? 'v1' : 'legacy';
  } catch {
    return 'legacy';
  }
}

function rowToModel(row: Record<string, unknown>): AgentCookbook {
  const definitionJson = (row.definition_json as string | null) ?? null;
  const schemaVersion = (row.schema_version as number | null) ?? null;
  return {
    id: row.id as string,
    title: row.title as string,
    description: (row.description as string | null) ?? null,
    stepsJson: (row.steps_json as string) ?? '[]',
    boundConfigId: (row.bound_config_id as string | null) ?? null,
    ownerUserId: (row.owner_user_id as number | null) ?? null,
    createdAt:
      typeof row.created_at === 'string'
        ? row.created_at
        : (row.created_at as Date).toISOString(),
    updatedAt:
      typeof row.updated_at === 'string'
        ? row.updated_at
        : (row.updated_at as Date).toISOString(),
    schemaVersion,
    definitionJson,
    format: deriveFormat(schemaVersion, definitionJson),
  };
}

export class AgentCookbookRepository {
  async createAsync(input: CreateAgentCookbookInput): Promise<AgentCookbook> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const stepsJson = input.stepsJson ?? '[]';

    const schemaVersion = input.definitionJson != null ? (input.schemaVersion ?? 1) : null;
    const definitionJson = input.definitionJson ?? null;

    if (env.dbClient === 'postgres') {
      const r = await getPostgresPool().query(
        `INSERT INTO agent_cookbook
           (id, title, description, steps_json, bound_config_id, owner_user_id,
            schema_version, definition_json, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING *`,
        [
          id,
          input.title,
          input.description ?? null,
          stepsJson,
          input.boundConfigId ?? null,
          input.ownerUserId ?? null,
          schemaVersion,
          definitionJson,
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
            schema_version, definition_json, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        input.title,
        input.description ?? null,
        stepsJson,
        input.boundConfigId ?? null,
        input.ownerUserId ?? null,
        schemaVersion,
        definitionJson,
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

  async findByIdForOwnerAsync(
    id: string,
    ownerUserId: number,
  ): Promise<AgentCookbook | null> {
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query(
        `SELECT * FROM agent_cookbook
         WHERE id = $1 AND (owner_user_id IS NULL OR owner_user_id = $2)`,
        [id, ownerUserId],
      );
      return result.rows[0] ? rowToModel(result.rows[0]) : null;
    }
    const row = getDb()
      .prepare(
        `SELECT * FROM agent_cookbook
         WHERE id = ? AND (owner_user_id IS NULL OR owner_user_id = ?)`,
      )
      .get(id, ownerUserId);
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

  async listForOwnerAsync(ownerUserId: number): Promise<AgentCookbook[]> {
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query(
        `SELECT * FROM agent_cookbook
         WHERE (owner_user_id IS NULL OR owner_user_id = $1)
         ORDER BY created_at DESC`,
        [ownerUserId],
      );
      return result.rows.map(rowToModel);
    }
    const rows = getDb()
      .prepare(
        `SELECT * FROM agent_cookbook
         WHERE (owner_user_id IS NULL OR owner_user_id = ?)
         ORDER BY created_at DESC`,
      )
      .all(ownerUserId);
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
      schemaVersion: 'schema_version',
      definitionJson: 'definition_json',
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

  async updateForOwnerAsync(
    id: string,
    ownerUserId: number,
    patch: Partial<CreateAgentCookbookInput>,
  ): Promise<AgentCookbook | null> {
    if (!(await this.findByIdForOwnerAsync(id, ownerUserId))) return null;
    await this.updateAsync(id, patch);
    return this.findByIdForOwnerAsync(id, ownerUserId);
  }

  async deleteForOwnerAsync(
    id: string,
    ownerUserId: number,
  ): Promise<boolean> {
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query(
        `DELETE FROM agent_cookbook
         WHERE id = $1 AND (owner_user_id IS NULL OR owner_user_id = $2)`,
        [id, ownerUserId],
      );
      return (result.rowCount ?? 0) > 0;
    }
    const result = getDb()
      .prepare(
        `DELETE FROM agent_cookbook
         WHERE id = ? AND (owner_user_id IS NULL OR owner_user_id = ?)`,
      )
      .run(id, ownerUserId);
    return result.changes > 0;
  }
}
