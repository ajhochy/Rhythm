import { randomUUID } from 'node:crypto';
import { getDb, getPostgresPool } from '../database/db';
import { env } from '../config/env';

export interface AgentScheduledTask {
  id: string;
  name: string;
  description: string | null;
  scheduleType: string;
  scheduledTime: string | null;
  scheduledDay: number | null;
  cronExpression: string | null;
  runAt: string | null;
  timezone: string;
  nextRunAt: string | null;
  prompt: string;
  agentKind: string;
  agentConfigId: string | null;
  allowedMcpsJson: string | null;
  allowedSkillsJson: string | null;
  enabled: boolean;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  lastError: string | null;
  createdByUserId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAgentScheduledTaskInput {
  name: string;
  description?: string;
  scheduleType: string;
  scheduledTime?: string;
  scheduledDay?: number;
  cronExpression?: string;
  runAt?: string;
  timezone?: string;
  nextRunAt?: string;
  prompt: string;
  agentKind?: string;
  agentConfigId?: string | null;
  allowedMcpsJson?: string;
  allowedSkillsJson?: string;
  createdByUserId?: number;
}

function rowToModel(row: Record<string, unknown>): AgentScheduledTask {
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string | null) ?? null,
    scheduleType: row.schedule_type as string,
    scheduledTime: (row.scheduled_time as string | null) ?? null,
    scheduledDay: (row.scheduled_day as number | null) ?? null,
    cronExpression: (row.cron_expression as string | null) ?? null,
    runAt: (row.run_at as string | null) ?? null,
    timezone: (row.timezone as string) ?? 'America/Los_Angeles',
    nextRunAt:
      row.next_run_at == null
        ? null
        : typeof row.next_run_at === 'string'
          ? row.next_run_at
          : (row.next_run_at as Date).toISOString(),
    prompt: row.prompt as string,
    agentKind: (row.agent_kind as string) ?? 'opencode',
    agentConfigId: (row.agent_config_id as string | null) ?? null,
    allowedMcpsJson: (row.allowed_mcps_json as string | null) ?? null,
    allowedSkillsJson: (row.allowed_skills_json as string | null) ?? null,
    enabled: typeof row.enabled === 'boolean' ? row.enabled : row.enabled !== 0,
    lastRunAt:
      row.last_run_at == null
        ? null
        : typeof row.last_run_at === 'string'
          ? row.last_run_at
          : (row.last_run_at as Date).toISOString(),
    lastRunStatus: (row.last_run_status as string | null) ?? null,
    lastError: (row.last_error as string | null) ?? null,
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

export class AgentScheduledTasksRepository {
  async createAsync(input: CreateAgentScheduledTaskInput): Promise<AgentScheduledTask> {
    const id = randomUUID();
    const now = new Date().toISOString();

    if (env.dbClient === 'postgres') {
      const r = await getPostgresPool().query(
        `INSERT INTO agent_scheduled_tasks
           (id, name, description, schedule_type, scheduled_time, scheduled_day,
            cron_expression, run_at, timezone, next_run_at, prompt, agent_kind,
            agent_config_id,
            allowed_mcps_json, allowed_skills_json, created_by_user_id, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         RETURNING *`,
        [
          id, input.name, input.description ?? null,
          input.scheduleType, input.scheduledTime ?? null,
          input.scheduledDay ?? null, input.cronExpression ?? null,
          input.runAt ?? null, input.timezone ?? 'America/Los_Angeles',
          input.nextRunAt ?? null, input.prompt,
          input.agentKind ?? 'opencode',
          input.agentConfigId ?? null,
          input.allowedMcpsJson ?? null, input.allowedSkillsJson ?? null,
          input.createdByUserId ?? null, now, now,
        ],
      );
      return rowToModel(r.rows[0]);
    }

    getDb().prepare(`
      INSERT INTO agent_scheduled_tasks
        (id, name, description, schedule_type, scheduled_time, scheduled_day,
         cron_expression, run_at, timezone, next_run_at, prompt, agent_kind,
         agent_config_id,
         allowed_mcps_json, allowed_skills_json, created_by_user_id, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      id, input.name, input.description ?? null,
      input.scheduleType, input.scheduledTime ?? null,
      input.scheduledDay ?? null, input.cronExpression ?? null,
      input.runAt ?? null, input.timezone ?? 'America/Los_Angeles',
      input.nextRunAt ?? null, input.prompt,
      input.agentKind ?? 'opencode',
      input.agentConfigId ?? null,
      input.allowedMcpsJson ?? null, input.allowedSkillsJson ?? null,
      input.createdByUserId ?? null, now, now,
    );

    return this.findByIdAsync(id) as Promise<AgentScheduledTask>;
  }

  async findByIdAsync(id: string): Promise<AgentScheduledTask | null> {
    if (env.dbClient === 'postgres') {
      const r = await getPostgresPool().query(
        `SELECT * FROM agent_scheduled_tasks WHERE id = $1`, [id],
      );
      return r.rows.length > 0 ? rowToModel(r.rows[0]) : null;
    }
    const row = getDb().prepare(`SELECT * FROM agent_scheduled_tasks WHERE id = ?`).get(id);
    return row ? rowToModel(row as Record<string, unknown>) : null;
  }

  async listAllAsync(): Promise<AgentScheduledTask[]> {
    if (env.dbClient === 'postgres') {
      const r = await getPostgresPool().query(
        `SELECT * FROM agent_scheduled_tasks ORDER BY created_at DESC`,
      );
      return r.rows.map(rowToModel);
    }
    const rows = getDb().prepare(`SELECT * FROM agent_scheduled_tasks ORDER BY created_at DESC`).all();
    return (rows as Record<string, unknown>[]).map(rowToModel);
  }

  /** Find tasks due to run: enabled AND next_run_at <= now. */
  async findDueAsync(): Promise<AgentScheduledTask[]> {
    const now = new Date().toISOString();
    if (env.dbClient === 'postgres') {
      const r = await getPostgresPool().query(
        `SELECT * FROM agent_scheduled_tasks
         WHERE enabled = TRUE AND next_run_at IS NOT NULL AND next_run_at <= $1
         ORDER BY next_run_at ASC`,
        [now],
      );
      return r.rows.map(rowToModel);
    }
    const rows = getDb().prepare(
      `SELECT * FROM agent_scheduled_tasks
       WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?
       ORDER BY next_run_at ASC`,
    ).all(now);
    return (rows as Record<string, unknown>[]).map(rowToModel);
  }

  async updateNextRunAsync(id: string, nextRunAt: string | null, lastRunAt: string, lastRunStatus: string, lastError?: string): Promise<void> {
    const now = new Date().toISOString();
    if (env.dbClient === 'postgres') {
      await getPostgresPool().query(
        `UPDATE agent_scheduled_tasks
         SET next_run_at = $1, last_run_at = $2, last_run_status = $3,
             last_error = $4, updated_at = $5
         WHERE id = $6`,
        [nextRunAt, lastRunAt, lastRunStatus, lastError ?? null, now, id],
      );
      return;
    }
    getDb().prepare(
      `UPDATE agent_scheduled_tasks
       SET next_run_at = ?, last_run_at = ?, last_run_status = ?,
           last_error = ?, updated_at = ?
       WHERE id = ?`,
    ).run(nextRunAt, lastRunAt, lastRunStatus, lastError ?? null, now, id);
  }

  async updateAsync(id: string, patch: Partial<CreateAgentScheduledTaskInput & { enabled: boolean; nextRunAt: string | null }>): Promise<AgentScheduledTask | null> {
    const now = new Date().toISOString();
    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    const map: Record<string, string> = {
      name: 'name', description: 'description', scheduleType: 'schedule_type',
      scheduledTime: 'scheduled_time', scheduledDay: 'scheduled_day',
      cronExpression: 'cron_expression', runAt: 'run_at', timezone: 'timezone',
      nextRunAt: 'next_run_at', prompt: 'prompt', agentKind: 'agent_kind',
      agentConfigId: 'agent_config_id',
      allowedMcpsJson: 'allowed_mcps_json', allowedSkillsJson: 'allowed_skills_json',
      enabled: 'enabled',
    };

    for (const [k, col] of Object.entries(map)) {
      if (k in patch) {
        fields.push(env.dbClient === 'postgres' ? `${col} = $${i++}` : `${col} = ?`);
        values.push((patch as Record<string, unknown>)[k] ?? null);
      }
    }
    if (fields.length === 0) return this.findByIdAsync(id);

    fields.push(env.dbClient === 'postgres' ? `updated_at = $${i++}` : `updated_at = ?`);
    values.push(now);

    if (env.dbClient === 'postgres') {
      values.push(id);
      await getPostgresPool().query(
        `UPDATE agent_scheduled_tasks SET ${fields.join(', ')} WHERE id = $${i}`,
        values,
      );
    } else {
      values.push(id);
      getDb().prepare(
        `UPDATE agent_scheduled_tasks SET ${fields.join(', ')} WHERE id = ?`,
      ).run(...values);
    }
    return this.findByIdAsync(id);
  }

  async deleteAsync(id: string): Promise<boolean> {
    if (env.dbClient === 'postgres') {
      const r = await getPostgresPool().query(
        `DELETE FROM agent_scheduled_tasks WHERE id = $1`, [id],
      );
      return (r.rowCount ?? 0) > 0;
    }
    const r = getDb().prepare(`DELETE FROM agent_scheduled_tasks WHERE id = ?`).run(id);
    return r.changes > 0;
  }
}
