import { env } from '../config/env';
import { getDb, getPostgresPool } from '../database/db';

export interface PendingClaudeTrigger {
  id: number;
  /** Null for scheduler- or webhook-originated triggers */
  taskId: string | null;
  triggeredByUserId: number | null;
  createdAt: string;
  /** Populated when task_id is non-null */
  taskTitle: string | null;
  taskNotes: string | null;
  taskOwnerId: number | null;
  profileId: string | null;
  /** Populated for scheduler / webhook / research triggers */
  prompt: string | null;
  scheduledTaskId: string | null;
  webhookEndpointId: string | null;
  webhookEndpointName: string | null;
  allowedMcps: string[] | null;
  allowedSkills: string[] | null;
  modelProvider: string | null;
  modelId: string | null;
}

/** SELECT clause used where the local agent/webhook tables exist. */
const LOCAL_SELECT_SQL = `
  SELECT pct.id,
         pct.task_id,
         pct.triggered_by_user_id,
         pct.created_at,
         pct.prompt,
         pct.scheduled_task_id,
         pct.webhook_endpoint_id,
         awe.name AS webhook_endpoint_name,
         pct.allowed_mcps_json,
         pct.allowed_skills_json,
         pct.model_provider,
         pct.model_id,
          COALESCE(t.title, st.name, awe.name, CAST(awe.id AS TEXT)) AS task_title,
          st.agent_config_id AS profile_id,
         t.notes    AS task_notes,
         t.owner_id AS task_owner_id
  FROM pending_claude_triggers pct
  LEFT JOIN tasks t ON t.id = pct.task_id
  LEFT JOIN agent_scheduled_tasks st ON st.id = pct.scheduled_task_id
  LEFT JOIN agent_webhook_endpoints awe ON awe.id = pct.webhook_endpoint_id
`;

/**
 * Cloud/relay roles intentionally do not bootstrap agent_webhook_endpoints.
 * Keep trigger reads usable there by deriving the title from production-owned
 * tables and the persisted endpoint id only.
 */
const CLOUD_SELECT_SQL = `
  SELECT pct.id,
         pct.task_id,
         pct.triggered_by_user_id,
         pct.created_at,
         pct.prompt,
         pct.scheduled_task_id,
         pct.webhook_endpoint_id,
         NULL AS webhook_endpoint_name,
         pct.allowed_mcps_json,
         pct.allowed_skills_json,
         pct.model_provider,
         pct.model_id,
         COALESCE(t.title, st.name, CAST(pct.webhook_endpoint_id AS TEXT)) AS task_title,
         st.agent_config_id AS profile_id,
         t.notes    AS task_notes,
         t.owner_id AS task_owner_id
  FROM pending_claude_triggers pct
  LEFT JOIN tasks t ON t.id = pct.task_id
  LEFT JOIN agent_scheduled_tasks st ON st.id = pct.scheduled_task_id
`;

function selectSql(): string {
  return env.agentExecutionEnabled ? LOCAL_SELECT_SQL : CLOUD_SELECT_SQL;
}

export class ClaudeTriggersRepository {
  async insertAsync(taskId: string, triggeredByUserId: number | null): Promise<void> {
    if (env.dbClient === 'postgres') {
      await getPostgresPool().query(
        `INSERT INTO pending_claude_triggers (task_id, triggered_by_user_id)
         VALUES ($1, $2) ON CONFLICT (task_id) DO NOTHING`,
        [taskId, triggeredByUserId],
      );
      return;
    }
    getDb()
      .prepare(
        `INSERT OR IGNORE INTO pending_claude_triggers (task_id, triggered_by_user_id)
         VALUES (?, ?)`,
      )
      .run(taskId, triggeredByUserId);
  }

  async listAllAsync(): Promise<PendingClaudeTrigger[]> {
    const sql = `${selectSql()} ORDER BY pct.created_at ASC`;
    if (env.dbClient === 'postgres') {
      const r = await getPostgresPool().query(sql);
      return r.rows.map(this.rowToModel);
    }
    const rows = getDb().prepare(sql).all() as any[];
    return rows.map(this.rowToModel);
  }

  async listForUser(userId: number): Promise<PendingClaudeTrigger[]> {
    const pgSql = `${selectSql()} WHERE pct.triggered_by_user_id = $1 ORDER BY pct.created_at ASC`;
    if (env.dbClient === 'postgres') {
      const r = await getPostgresPool().query(pgSql, [userId]);
      return r.rows.map(this.rowToModel);
    }
    const sqliteSql = pgSql.replace('$1', '?');
    const rows = getDb().prepare(sqliteSql).all(userId) as any[];
    return rows.map(this.rowToModel);
  }

  async listLocalUnowned(): Promise<PendingClaudeTrigger[]> {
    const sql = `${selectSql()} WHERE pct.triggered_by_user_id IS NULL ORDER BY pct.created_at ASC`;
    if (env.dbClient === 'postgres') {
      const r = await getPostgresPool().query(sql);
      return r.rows.map(this.rowToModel);
    }
    const rows = getDb().prepare(sql).all() as any[];
    return rows.map(this.rowToModel);
  }

  async findByIdAndUser(id: number, userId: number): Promise<PendingClaudeTrigger | null> {
    const pgSql = `${selectSql()} WHERE pct.id = $1 AND pct.triggered_by_user_id = $2`;
    if (env.dbClient === 'postgres') {
      const r = await getPostgresPool().query(pgSql, [id, userId]);
      return r.rows.length > 0 ? this.rowToModel(r.rows[0]) : null;
    }
    const sqliteSql = pgSql.replace('$1', '?').replace('$2', '?');
    const row = getDb().prepare(sqliteSql).get(id, userId) as any | undefined;
    return row ? this.rowToModel(row) : null;
  }

  async findByIdAsync(id: number): Promise<PendingClaudeTrigger | null> {
    const pgSql = `${selectSql()} WHERE pct.id = $1`;
    if (env.dbClient === 'postgres') {
      const r = await getPostgresPool().query(pgSql, [id]);
      return r.rows.length > 0 ? this.rowToModel(r.rows[0]) : null;
    }
    const sqliteSql = pgSql.replace('$1', '?');
    const row = getDb().prepare(sqliteSql).get(id) as any | undefined;
    return row ? this.rowToModel(row) : null;
  }

  async deleteAsync(id: number): Promise<boolean> {
    if (env.dbClient === 'postgres') {
      const r = await getPostgresPool().query(
        `DELETE FROM pending_claude_triggers WHERE id = $1`,
        [id],
      );
      return (r.rowCount ?? 0) > 0;
    }
    const r = getDb()
      .prepare(`DELETE FROM pending_claude_triggers WHERE id = ?`)
      .run(id);
    return r.changes > 0;
  }

  async deleteLocalUnowned(id: number): Promise<boolean> {
    if (env.dbClient === 'postgres') {
      const r = await getPostgresPool().query(
        `DELETE FROM pending_claude_triggers
         WHERE id = $1 AND triggered_by_user_id IS NULL`,
        [id],
      );
      return (r.rowCount ?? 0) > 0;
    }
    const r = getDb()
      .prepare(
        `DELETE FROM pending_claude_triggers
         WHERE id = ? AND triggered_by_user_id IS NULL`,
      )
      .run(id);
    return r.changes > 0;
  }

  private rowToModel(row: any): PendingClaudeTrigger {
    let allowedMcps: string[] | null = null;
    let allowedSkills: string[] | null = null;
    try { if (row.allowed_mcps_json) allowedMcps = JSON.parse(row.allowed_mcps_json); } catch { /* ignore */ }
    try { if (row.allowed_skills_json) allowedSkills = JSON.parse(row.allowed_skills_json); } catch { /* ignore */ }

    return {
      id: row.id,
      taskId: row.task_id ?? null,
      triggeredByUserId: row.triggered_by_user_id ?? null,
      createdAt:
        typeof row.created_at === 'string'
          ? row.created_at
          : row.created_at.toISOString(),
      taskTitle: row.task_title ?? null,
      taskNotes: row.task_notes ?? null,
      taskOwnerId: row.task_owner_id ?? null,
      profileId: row.profile_id ?? null,
      prompt: row.prompt ?? null,
      scheduledTaskId: row.scheduled_task_id ?? null,
      webhookEndpointId: row.webhook_endpoint_id ?? null,
      webhookEndpointName: row.webhook_endpoint_name ?? null,
      allowedMcps,
      allowedSkills,
      modelProvider: row.model_provider ?? null,
      modelId: row.model_id ?? null,
    };
  }
}
