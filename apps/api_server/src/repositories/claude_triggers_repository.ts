import { env } from '../config/env';
import { getDb, getPostgresPool } from '../database/db';

export interface PendingClaudeTrigger {
  id: number;
  taskId: string;
  triggeredByUserId: number | null;
  createdAt: string;
  taskTitle: string;
  taskNotes: string | null;
  taskOwnerId: number | null;
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
    const sql = `
      SELECT pct.id, pct.task_id, pct.triggered_by_user_id, pct.created_at,
             t.title AS task_title, t.notes AS task_notes, t.owner_id AS task_owner_id
      FROM pending_claude_triggers pct
      JOIN tasks t ON t.id = pct.task_id
      ORDER BY pct.created_at ASC
    `;
    if (env.dbClient === 'postgres') {
      const r = await getPostgresPool().query(sql);
      return r.rows.map(this.rowToModel);
    }
    const rows = getDb().prepare(sql).all() as any[];
    return rows.map(this.rowToModel);
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

  private rowToModel(row: any): PendingClaudeTrigger {
    return {
      id: row.id,
      taskId: row.task_id,
      triggeredByUserId: row.triggered_by_user_id,
      createdAt:
        typeof row.created_at === 'string'
          ? row.created_at
          : row.created_at.toISOString(),
      taskTitle: row.task_title,
      taskNotes: row.task_notes,
      taskOwnerId: row.task_owner_id,
    };
  }
}
