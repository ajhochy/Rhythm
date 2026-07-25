import { randomUUID } from 'node:crypto';
import { getDb, getPostgresPool } from '../database/db';
import { env } from '../config/env';

export interface AgentWebhookEndpoint {
  id: string;
  name: string;
  eventTypesJson: string;
  secret: string;
  targetScheduledTaskId: string | null;
  targetPrompt: string | null;
  enabled: boolean;
  lastTriggeredAt: string | null;
  triggerCount: number;
  createdByUserId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateWebhookEndpointInput {
  name: string;
  eventTypesJson?: string;
  secret?: string;
  targetScheduledTaskId?: string;
  targetPrompt?: string;
  createdByUserId?: number;
}

function rowToModel(row: Record<string, unknown>): AgentWebhookEndpoint {
  return {
    id: row.id as string,
    name: row.name as string,
    eventTypesJson: (row.event_types_json as string) ?? '["*"]',
    secret: row.secret as string,
    targetScheduledTaskId: (row.target_scheduled_task_id as string | null) ?? null,
    targetPrompt: (row.target_prompt as string | null) ?? null,
    enabled: typeof row.enabled === 'boolean' ? row.enabled : row.enabled !== 0,
    lastTriggeredAt:
      row.last_triggered_at == null
        ? null
        : typeof row.last_triggered_at === 'string'
          ? row.last_triggered_at
          : (row.last_triggered_at as Date).toISOString(),
    triggerCount: (row.trigger_count as number) ?? 0,
    createdByUserId: (row.created_by_user_id as number | null) ?? null,
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

export class AgentWebhookEndpointsRepository {
  async createAsync(input: CreateWebhookEndpointInput): Promise<AgentWebhookEndpoint> {
    const id = randomUUID();
    const now = new Date().toISOString();
    // Generate a random secret if not provided
    const secret = input.secret ?? randomUUID().replace(/-/g, '');

    if (env.dbClient === 'postgres') {
      const r = await getPostgresPool().query(
        `INSERT INTO agent_webhook_endpoints
           (id, name, event_types_json, secret, target_scheduled_task_id, target_prompt,
            created_by_user_id, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING *`,
        [
          id, input.name, input.eventTypesJson ?? '["*"]', secret,
          input.targetScheduledTaskId ?? null, input.targetPrompt ?? null,
          input.createdByUserId ?? null, now, now,
        ],
      );
      return rowToModel(r.rows[0]);
    }

    getDb().prepare(`
      INSERT INTO agent_webhook_endpoints
        (id, name, event_types_json, secret, target_scheduled_task_id, target_prompt,
         created_by_user_id, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(
      id, input.name, input.eventTypesJson ?? '["*"]', secret,
      input.targetScheduledTaskId ?? null, input.targetPrompt ?? null,
      input.createdByUserId ?? null, now, now,
    );

    return (await this.findByIdAsync(id))!;
  }

  async findByIdAsync(id: string): Promise<AgentWebhookEndpoint | null> {
    if (env.dbClient === 'postgres') {
      const r = await getPostgresPool().query(
        `SELECT * FROM agent_webhook_endpoints WHERE id = $1`, [id],
      );
      return r.rows.length > 0 ? rowToModel(r.rows[0]) : null;
    }
    const row = getDb().prepare(`SELECT * FROM agent_webhook_endpoints WHERE id = ?`).get(id);
    return row ? rowToModel(row as Record<string, unknown>) : null;
  }

  async findByIdForOwnerAsync(
    id: string,
    ownerUserId: number,
  ): Promise<AgentWebhookEndpoint | null> {
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query(
        `SELECT * FROM agent_webhook_endpoints
         WHERE id = $1 AND created_by_user_id = $2`,
        [id, ownerUserId],
      );
      return result.rows[0] ? rowToModel(result.rows[0]) : null;
    }
    const row = getDb()
      .prepare(
        `SELECT * FROM agent_webhook_endpoints
         WHERE id = ? AND created_by_user_id = ?`,
      )
      .get(id, ownerUserId);
    return row ? rowToModel(row as Record<string, unknown>) : null;
  }

  async listAsync(): Promise<AgentWebhookEndpoint[]> {
    if (env.dbClient === 'postgres') {
      const r = await getPostgresPool().query(
        `SELECT * FROM agent_webhook_endpoints ORDER BY created_at DESC`,
      );
      return r.rows.map(rowToModel);
    }
    const rows = getDb().prepare(`SELECT * FROM agent_webhook_endpoints ORDER BY created_at DESC`).all();
    return (rows as Record<string, unknown>[]).map(rowToModel);
  }

  async listForOwnerAsync(ownerUserId: number): Promise<AgentWebhookEndpoint[]> {
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query(
        `SELECT * FROM agent_webhook_endpoints
         WHERE created_by_user_id = $1
         ORDER BY created_at DESC`,
        [ownerUserId],
      );
      return result.rows.map(rowToModel);
    }
    const rows = getDb()
      .prepare(
        `SELECT * FROM agent_webhook_endpoints
         WHERE created_by_user_id = ?
         ORDER BY created_at DESC`,
      )
      .all(ownerUserId);
    return (rows as Record<string, unknown>[]).map(rowToModel);
  }

  async recordTriggerAsync(id: string): Promise<void> {
    const now = new Date().toISOString();
    if (env.dbClient === 'postgres') {
      await getPostgresPool().query(
        `UPDATE agent_webhook_endpoints
         SET last_triggered_at = $1, trigger_count = trigger_count + 1, updated_at = $1
         WHERE id = $2`,
        [now, id],
      );
      return;
    }
    getDb().prepare(
      `UPDATE agent_webhook_endpoints
       SET last_triggered_at = ?, trigger_count = trigger_count + 1, updated_at = ?
       WHERE id = ?`,
    ).run(now, now, id);
  }

  async deleteAsync(id: string): Promise<boolean> {
    if (env.dbClient === 'postgres') {
      const r = await getPostgresPool().query(
        `DELETE FROM agent_webhook_endpoints WHERE id = $1`, [id],
      );
      return (r.rowCount ?? 0) > 0;
    }
    const r = getDb().prepare(`DELETE FROM agent_webhook_endpoints WHERE id = ?`).run(id);
    return r.changes > 0;
  }

  async deleteForOwnerAsync(
    id: string,
    ownerUserId: number,
  ): Promise<boolean> {
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query(
        `DELETE FROM agent_webhook_endpoints
         WHERE id = $1 AND created_by_user_id = $2`,
        [id, ownerUserId],
      );
      return (result.rowCount ?? 0) > 0;
    }
    const result = getDb()
      .prepare(
        `DELETE FROM agent_webhook_endpoints
         WHERE id = ? AND created_by_user_id = ?`,
      )
      .run(id, ownerUserId);
    return result.changes > 0;
  }
}
