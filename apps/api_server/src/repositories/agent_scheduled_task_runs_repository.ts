/**
 * Config Doctor D1 — per-run history for scheduled tasks.
 *
 * agent_scheduled_tasks keeps a single overwritten last-run slot
 * (last_run_at/last_run_status/last_error). This table adds a durable row
 * per run so a task's real history (e.g. failed twice then succeeded) is
 * visible instead of only the most recent outcome. Additive, dual-DB
 * (SQLite + Postgres) — see migrations.ts / postgres_bootstrap.ts.
 */

import { randomUUID } from 'node:crypto';
import { getDb, getPostgresPool } from '../database/db';
import { env } from '../config/env';

export interface AgentScheduledTaskRun {
  id: string;
  taskId: string;
  startedAt: string;
  endedAt: string;
  status: string;
  error: string | null;
  rootSessionId: string | null;
  createdAt: string;
}

export interface CreateAgentScheduledTaskRunInput {
  taskId: string;
  startedAt: string;
  endedAt: string;
  status: string;
  error?: string | null;
  rootSessionId?: string | null;
}

function rowToModel(row: Record<string, unknown>): AgentScheduledTaskRun {
  return {
    id: row.id as string,
    taskId: row.task_id as string,
    startedAt: row.started_at as string,
    endedAt: row.ended_at as string,
    status: row.status as string,
    error: (row.error as string | null) ?? null,
    rootSessionId: (row.root_session_id as string | null) ?? null,
    createdAt:
      typeof row.created_at === 'string'
        ? row.created_at
        : (row.created_at as Date).toISOString(),
  };
}

export class AgentScheduledTaskRunsRepository {
  async create(input: CreateAgentScheduledTaskRunInput): Promise<AgentScheduledTaskRun> {
    const id = randomUUID();
    const now = new Date().toISOString();

    if (env.dbClient === 'postgres') {
      const r = await getPostgresPool().query(
        `INSERT INTO agent_scheduled_task_runs
           (id, task_id, started_at, ended_at, status, error, root_session_id, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING *`,
        [
          id, input.taskId, input.startedAt, input.endedAt, input.status,
          input.error ?? null, input.rootSessionId ?? null, now,
        ],
      );
      return rowToModel(r.rows[0]);
    }

    getDb().prepare(`
      INSERT INTO agent_scheduled_task_runs
        (id, task_id, started_at, ended_at, status, error, root_session_id, created_at)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(
      id, input.taskId, input.startedAt, input.endedAt, input.status,
      input.error ?? null, input.rootSessionId ?? null, now,
    );

    const row = getDb().prepare(`SELECT * FROM agent_scheduled_task_runs WHERE id = ?`).get(id);
    return rowToModel(row as Record<string, unknown>);
  }

  /** Newest first, bounded by `limit` (default 20, max 100). */
  async listForTask(taskId: string, limit = 20): Promise<AgentScheduledTaskRun[]> {
    const boundedLimit = Math.min(Math.max(1, limit), 100);

    if (env.dbClient === 'postgres') {
      const r = await getPostgresPool().query(
        `SELECT * FROM agent_scheduled_task_runs
         WHERE task_id = $1
         ORDER BY started_at DESC
         LIMIT $2`,
        [taskId, boundedLimit],
      );
      return r.rows.map(rowToModel);
    }

    const rows = getDb()
      .prepare(
        `SELECT * FROM agent_scheduled_task_runs
         WHERE task_id = ?
         ORDER BY started_at DESC
         LIMIT ?`,
      )
      .all(taskId, boundedLimit);
    return (rows as Record<string, unknown>[]).map(rowToModel);
  }
}
