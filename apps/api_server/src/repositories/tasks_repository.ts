import { env } from '../config/env';
import { v4 as uuidv4 } from 'uuid';
import { getDb, getPostgresPool } from '../database/db';
import { AppError } from '../errors/app_error';
import type { CreateTaskDto, Task, UpdateTaskDto } from '../models/task';

interface TaskRow {
  id: string;
  title: string;
  notes: string | null;
  due_date: string | null;
  scheduled_date: string | null;
  scheduled_order: number | null;
  locked: number;
  status: string;
  source_type: string | null;
  source_id: string | null;
  source_name: string | null;
  owner_id: number | null;
  created_at: string;
  updated_at: string;
}

function rowToTask(row: TaskRow): Task {
  const locked =
    typeof row.locked === 'boolean' ? row.locked : row.locked === 1;

  return {
    id: row.id,
    title: row.title,
    notes: row.notes ?? null,
    dueDate: row.due_date,
    scheduledDate: row.scheduled_date ?? null,
    scheduledOrder: row.scheduled_order ?? null,
    locked,
    status: row.status as Task['status'],
    sourceType: row.source_type,
    sourceId: row.source_id,
    sourceName: row.source_name ?? null,
    ownerId: row.owner_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const TASK_SELECT = `
  SELECT
    tasks.*,
    CASE
      WHEN tasks.source_type = 'project_step' THEN COALESCE(pi.name, pt.name)
      WHEN tasks.source_type = 'recurring_rule' THEN rr.title
      ELSE NULL
    END AS source_name
  FROM tasks
  LEFT JOIN project_instances pi
    ON tasks.source_type = 'project_step'
   AND tasks.source_id = pi.id
  LEFT JOIN project_templates pt
    ON pi.template_id = pt.id
  LEFT JOIN recurring_task_rules rr
    ON tasks.source_type = 'recurring_rule'
   AND (tasks.source_id = rr.id OR tasks.source_id LIKE rr.id || ':%')
`;

export class TasksRepository {
  async findAllAsync(userId?: number): Promise<Task[]> {
    if (env.dbClient === 'postgres') {
      const result =
        userId != null
          ? await getPostgresPool().query<TaskRow>(
              `${TASK_SELECT}
               WHERE tasks.owner_id = $1 OR tasks.owner_id IS NULL
               ORDER BY tasks.due_date ASC, tasks.scheduled_order ASC, tasks.created_at ASC`,
              [userId],
            )
          : await getPostgresPool().query<TaskRow>(
              `${TASK_SELECT}
               ORDER BY tasks.due_date ASC, tasks.scheduled_order ASC, tasks.created_at ASC`,
            );
      return result.rows.map(rowToTask);
    }

    return this.findAll(userId);
  }

  findAll(userId?: number): Task[] {
    if (userId != null) {
      const rows = getDb()
        .prepare(
          `${TASK_SELECT}
           WHERE tasks.owner_id = ? OR tasks.owner_id IS NULL
           ORDER BY tasks.due_date ASC, tasks.scheduled_order ASC, tasks.created_at ASC`,
        )
        .all(userId) as TaskRow[];
      return rows.map(rowToTask);
    }
    const rows = getDb()
      .prepare(`${TASK_SELECT} ORDER BY tasks.due_date ASC, tasks.scheduled_order ASC, tasks.created_at ASC`)
      .all() as TaskRow[];
    return rows.map(rowToTask);
  }

  async findByIdAsync(id: string, userId?: number): Promise<Task> {
    if (env.dbClient === 'postgres') {
      const result =
        userId != null
          ? await getPostgresPool().query<TaskRow>(
              `${TASK_SELECT} WHERE tasks.id = $1 AND (tasks.owner_id = $2 OR tasks.owner_id IS NULL)`,
              [id, userId],
            )
          : await getPostgresPool().query<TaskRow>(
              `${TASK_SELECT} WHERE tasks.id = $1`,
              [id],
            );
      const row = result.rows[0];
      if (!row) throw AppError.notFound('Task');
      return rowToTask(row);
    }

    return this.findById(id, userId);
  }

  findById(id: string, userId?: number): Task {
    const row = (userId != null
      ? getDb()
          .prepare(
            `${TASK_SELECT} WHERE tasks.id = ? AND (tasks.owner_id = ? OR tasks.owner_id IS NULL)`,
          )
          .get(id, userId)
      : getDb().prepare(`${TASK_SELECT} WHERE tasks.id = ?`).get(id)) as
      | TaskRow
      | undefined;
    if (!row) throw AppError.notFound('Task');
    return rowToTask(row);
  }

  async findBySourceAsync(sourceType: string, sourceId: string): Promise<Task | null> {
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query<TaskRow>(
        `${TASK_SELECT} WHERE tasks.source_type = $1 AND tasks.source_id = $2 LIMIT 1`,
        [sourceType, sourceId],
      );
      const row = result.rows[0];
      return row ? rowToTask(row) : null;
    }

    return this.findBySource(sourceType, sourceId);
  }

  findBySource(sourceType: string, sourceId: string): Task | null {
    const row = getDb()
      .prepare(
        `${TASK_SELECT} WHERE tasks.source_type = ? AND tasks.source_id = ? LIMIT 1`,
      )
      .get(sourceType, sourceId) as TaskRow | undefined;
    return row ? rowToTask(row) : null;
  }

  async findBySourceAndDueDateAsync(
    sourceType: string,
    sourceId: string,
    dueDate: string,
  ): Promise<Task | null> {
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query<TaskRow>(
        `${TASK_SELECT}
         WHERE tasks.source_type = $1 AND tasks.source_id = $2 AND tasks.due_date = $3
         LIMIT 1`,
        [sourceType, sourceId, dueDate],
      );
      const row = result.rows[0];
      return row ? rowToTask(row) : null;
    }

    const row = getDb()
      .prepare(
        `${TASK_SELECT}
         WHERE tasks.source_type = ? AND tasks.source_id = ? AND tasks.due_date = ?
         LIMIT 1`,
      )
      .get(sourceType, sourceId, dueDate) as TaskRow | undefined;
    return row ? rowToTask(row) : null;
  }

  async findByWeekAsync(
    weekStart: string,
    weekEnd: string,
    userId?: number,
  ): Promise<Task[]> {
    if (env.dbClient === 'postgres') {
      const result =
        userId != null
          ? await getPostgresPool().query<TaskRow>(
              `${TASK_SELECT}
               WHERE (tasks.owner_id = $1 OR tasks.owner_id IS NULL)
                 AND (tasks.due_date BETWEEN $2 AND $3 OR tasks.scheduled_date BETWEEN $4 AND $5)
               ORDER BY tasks.due_date ASC, tasks.scheduled_order ASC, tasks.created_at ASC`,
              [userId, weekStart, weekEnd, weekStart, weekEnd],
            )
          : await getPostgresPool().query<TaskRow>(
              `${TASK_SELECT}
               WHERE (tasks.due_date BETWEEN $1 AND $2 OR tasks.scheduled_date BETWEEN $3 AND $4)
               ORDER BY tasks.due_date ASC, tasks.created_at ASC`,
              [weekStart, weekEnd, weekStart, weekEnd],
            );
      return result.rows.map(rowToTask);
    }

    return this.findByWeek(weekStart, weekEnd, userId);
  }

  findByWeek(weekStart: string, weekEnd: string, userId?: number): Task[] {
    if (userId != null) {
      const rows = getDb()
          .prepare(
            `${TASK_SELECT}
          WHERE (tasks.owner_id = ? OR tasks.owner_id IS NULL)
             AND (tasks.due_date BETWEEN ? AND ? OR tasks.scheduled_date BETWEEN ? AND ?)
         ORDER BY tasks.due_date ASC, tasks.scheduled_order ASC, tasks.created_at ASC`,
      )
        .all(userId, weekStart, weekEnd, weekStart, weekEnd) as TaskRow[];
      return rows.map(rowToTask);
    }
    const rows = getDb()
      .prepare(
        `${TASK_SELECT}
         WHERE (tasks.due_date BETWEEN ? AND ? OR tasks.scheduled_date BETWEEN ? AND ?)
         ORDER BY tasks.due_date ASC, tasks.created_at ASC`,
      )
      .all(weekStart, weekEnd, weekStart, weekEnd) as TaskRow[];
    return rows.map(rowToTask);
  }

  async findBacklogAsync(startOfWeek: string, userId?: number): Promise<Task[]> {
    if (env.dbClient === 'postgres') {
      const result =
        userId != null
          ? await getPostgresPool().query<TaskRow>(
              `${TASK_SELECT}
               WHERE tasks.status = 'open'
                 AND (
                   (tasks.due_date IS NULL AND tasks.scheduled_date IS NULL)
                   OR tasks.due_date < $1
                   OR tasks.scheduled_date < $2
                 )
                 AND (tasks.owner_id = $3 OR tasks.owner_id IS NULL)
               ORDER BY
                 CASE
                   WHEN tasks.scheduled_date IS NOT NULL THEN tasks.scheduled_date
                   ELSE tasks.due_date
                 END ASC,
                 tasks.created_at ASC`,
              [startOfWeek, startOfWeek, userId],
            )
          : await getPostgresPool().query<TaskRow>(
              `${TASK_SELECT}
               WHERE tasks.status = 'open'
                 AND (
                   (tasks.due_date IS NULL AND tasks.scheduled_date IS NULL)
                   OR tasks.due_date < $1
                   OR tasks.scheduled_date < $2
                 )
               ORDER BY
                 CASE
                   WHEN tasks.scheduled_date IS NOT NULL THEN tasks.scheduled_date
                   ELSE tasks.due_date
                 END ASC,
                 tasks.created_at ASC`,
              [startOfWeek, startOfWeek],
            );
      return result.rows.map(rowToTask);
    }

    const db = getDb();
    const rows =
      userId != null
        ? (db
            .prepare(
              `${TASK_SELECT}
               WHERE tasks.status = 'open'
                 AND (
                   (tasks.due_date IS NULL AND tasks.scheduled_date IS NULL)
                   OR tasks.due_date < ?
                   OR tasks.scheduled_date < ?
                 )
                 AND (tasks.owner_id = ? OR tasks.owner_id IS NULL)
               ORDER BY
                 CASE
                   WHEN tasks.scheduled_date IS NOT NULL THEN tasks.scheduled_date
                   ELSE tasks.due_date
                 END ASC,
                 tasks.created_at ASC`,
            )
            .all(startOfWeek, startOfWeek, userId) as TaskRow[])
        : (db
            .prepare(
              `${TASK_SELECT}
               WHERE tasks.status = 'open'
                 AND (
                   (tasks.due_date IS NULL AND tasks.scheduled_date IS NULL)
                   OR tasks.due_date < ?
                   OR tasks.scheduled_date < ?
                 )
               ORDER BY
                 CASE
                   WHEN tasks.scheduled_date IS NOT NULL THEN tasks.scheduled_date
                   ELSE tasks.due_date
                 END ASC,
                 tasks.created_at ASC`,
            )
            .all(startOfWeek, startOfWeek) as TaskRow[]);
    return rows.map(rowToTask);
  }

  async createAsync(data: CreateTaskDto): Promise<Task> {
    if (env.dbClient === 'postgres') {
      const id = uuidv4();
      const now = new Date().toISOString();
      await getPostgresPool().query(
        `INSERT INTO tasks (
          id, title, notes, due_date, scheduled_date, locked, status,
          scheduled_order, source_type, source_id, owner_id, created_at, updated_at
        )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          id,
          data.title,
          data.notes ?? null,
          data.dueDate ?? null,
          data.scheduledDate ?? null,
          data.locked ?? false,
          data.status ?? 'open',
          data.scheduledOrder ?? null,
          data.sourceType ?? null,
          data.sourceId ?? null,
          data.ownerId ?? null,
          now,
          now,
        ],
      );
      return this.findByIdAsync(id);
    }

    return this.create(data);
  }

  create(data: CreateTaskDto): Task {
    const id = uuidv4();
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO tasks (
          id, title, notes, due_date, scheduled_date, locked, status,
          scheduled_order, source_type, source_id, owner_id, created_at, updated_at
        )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        data.title,
        data.notes ?? null,
        data.dueDate ?? null,
        data.scheduledDate ?? null,
        data.locked ? 1 : 0,
        data.status ?? 'open',
        data.scheduledOrder ?? null,
        data.sourceType ?? null,
        data.sourceId ?? null,
        data.ownerId ?? null,
        now,
        now,
      );
    return this.findById(id);
  }

  async upsertExternalTaskAsync(data: CreateTaskDto): Promise<Task> {
    const existing =
      data.sourceType && data.sourceId
        ? await this.findBySourceAsync(data.sourceType, data.sourceId)
        : null;

    if (!existing) {
      return this.createAsync({
        ...data,
        status: data.status ?? 'open',
      });
    }

    return this.updateAsync(existing.id, {
      title: data.title,
      notes: data.notes ?? null,
      dueDate: data.dueDate ?? null,
      scheduledDate: data.scheduledDate ?? null,
      scheduledOrder: data.scheduledOrder ?? null,
      status: data.status ?? 'open',
      locked: data.locked ?? existing.locked,
    });
  }

  upsertExternalTask(data: CreateTaskDto): Task {
    const existing =
      data.sourceType && data.sourceId
        ? this.findBySource(data.sourceType, data.sourceId)
        : null;

    if (!existing) {
      return this.create({
        ...data,
        status: data.status ?? 'open',
      });
    }

    return this.update(existing.id, {
      title: data.title,
      notes: data.notes ?? null,
      dueDate: data.dueDate ?? null,
      scheduledDate: data.scheduledDate ?? null,
      scheduledOrder: data.scheduledOrder ?? null,
      status: data.status ?? 'open',
      locked: data.locked ?? existing.locked,
    });
  }

  async markOpenTasksDoneIfMissingAsync(
    sourceType: string,
    activeSourceIds: string[],
  ): Promise<number> {
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query<{
        id: string;
        source_id: string | null;
      }>(
        `SELECT id, source_id FROM tasks
         WHERE source_type = $1 AND status = 'open'`,
        [sourceType],
      );

      let changed = 0;
      for (const row of result.rows) {
        if (!row.source_id || activeSourceIds.includes(row.source_id)) continue;
        await this.updateAsync(row.id, { status: 'done' });
        changed += 1;
      }
      return changed;
    }

    return this.markOpenTasksDoneIfMissing(sourceType, activeSourceIds);
  }

  markOpenTasksDoneIfMissing(sourceType: string, activeSourceIds: string[]): number {
    const rows = getDb()
      .prepare(
        `SELECT id, source_id FROM tasks
         WHERE source_type = ? AND status = 'open'`,
      )
      .all(sourceType) as Array<{ id: string; source_id: string | null }>;

    let changed = 0;
    for (const row of rows) {
      if (!row.source_id || activeSourceIds.includes(row.source_id)) continue;
      this.update(row.id, { status: 'done' });
      changed += 1;
    }
    return changed;
  }

  async deleteTasksMissingFromSourceAsync(
    sourceType: string,
    activeSourceIds: string[],
  ): Promise<number> {
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query<{
        id: string;
        source_id: string | null;
      }>(
        `SELECT id, source_id FROM tasks
         WHERE source_type = $1`,
        [sourceType],
      );

      let changed = 0;
      for (const row of result.rows) {
        if (!row.source_id || activeSourceIds.includes(row.source_id)) continue;
        await getPostgresPool().query('DELETE FROM tasks WHERE id = $1', [row.id]);
        changed += 1;
      }
      return changed;
    }

    return this.deleteTasksMissingFromSource(sourceType, activeSourceIds);
  }

  deleteTasksMissingFromSource(sourceType: string, activeSourceIds: string[]): number {
    const rows = getDb()
      .prepare(
        `SELECT id, source_id FROM tasks
         WHERE source_type = ?`,
      )
      .all(sourceType) as Array<{ id: string; source_id: string | null }>;

    let changed = 0;
    for (const row of rows) {
      if (!row.source_id || activeSourceIds.includes(row.source_id)) continue;
      getDb().prepare('DELETE FROM tasks WHERE id = ?').run(row.id);
      changed += 1;
    }
    return changed;
  }

  async deleteFutureOpenBySourceIdAsync(
    sourceType: string,
    sourceId: string,
  ): Promise<number> {
    if (env.dbClient === 'postgres') {
      const today = new Date().toISOString().substring(0, 10);
      const result = await getPostgresPool().query(
        `DELETE FROM tasks
         WHERE source_type = $1
           AND (source_id = $2 OR source_id LIKE $2 || ':%')
           AND status = 'open'
           AND (due_date IS NULL OR due_date >= $3)`,
        [sourceType, sourceId, today],
      );
      return result.rowCount ?? 0;
    }

    return this.deleteFutureOpenBySourceId(sourceType, sourceId);
  }

  deleteFutureOpenBySourceId(sourceType: string, sourceId: string): number {
    const today = new Date().toISOString().substring(0, 10);
    const result = getDb()
      .prepare(
        `DELETE FROM tasks
         WHERE source_type = ?
           AND (source_id = ? OR source_id LIKE ? || ':%')
           AND status = 'open'
           AND (due_date IS NULL OR due_date >= ?)`,
      )
      .run(sourceType, sourceId, sourceId, today);
    return result.changes;
  }

  async deleteAllBySourceTypeAsync(sourceType: string): Promise<number> {
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query(
        'DELETE FROM tasks WHERE source_type = $1',
        [sourceType],
      );
      return result.rowCount ?? 0;
    }

    return this.deleteAllBySourceType(sourceType);
  }

  deleteAllBySourceType(sourceType: string): number {
    const result = getDb()
      .prepare('DELETE FROM tasks WHERE source_type = ?')
      .run(sourceType);
    return result.changes;
  }

  async updateAsync(id: string, data: UpdateTaskDto, userId?: number): Promise<Task> {
    if (env.dbClient === 'postgres') {
      const existing = await this.findByIdAsync(id, userId);
      const now = new Date().toISOString();
      const nextNotes = data.notes === '' ? null : data.notes;
      const nextDueDate = data.dueDate === '' ? null : data.dueDate;
      const nextScheduledDate =
        data.scheduledDate === '' ? null : data.scheduledDate;
      const nextScheduledOrder =
        data.scheduledOrder === null ? null : data.scheduledOrder;
      await getPostgresPool().query(
        `UPDATE tasks
         SET title = $1,
             notes = $2,
             due_date = $3,
             status = $4,
             scheduled_date = $5,
             scheduled_order = $6,
             locked = $7,
             owner_id = $8,
             updated_at = $9
         WHERE id = $10`,
        [
          data.title ?? existing.title,
          nextNotes !== undefined ? nextNotes : existing.notes,
          nextDueDate !== undefined ? nextDueDate : existing.dueDate,
          data.status ?? existing.status,
          nextScheduledDate !== undefined
            ? nextScheduledDate
            : existing.scheduledDate,
          data.scheduledOrder !== undefined
            ? nextScheduledOrder
            : existing.scheduledOrder,
          data.locked !== undefined ? data.locked : existing.locked,
          data.ownerId !== undefined ? data.ownerId : existing.ownerId,
          now,
          id,
        ],
      );
      return this.findByIdAsync(id, userId);
    }

    return this.update(id, data, userId);
  }

  update(id: string, data: UpdateTaskDto, userId?: number): Task {
    const existing = this.findById(id, userId);
    const now = new Date().toISOString();
    const nextNotes = data.notes === '' ? null : data.notes;
    const nextDueDate = data.dueDate === '' ? null : data.dueDate;
    const nextScheduledDate =
      data.scheduledDate === '' ? null : data.scheduledDate;
    const nextScheduledOrder =
      data.scheduledOrder === null ? null : data.scheduledOrder;
    getDb()
      .prepare(
        `UPDATE tasks
         SET title = ?, notes = ?, due_date = ?, status = ?,
             scheduled_date = ?, scheduled_order = ?, locked = ?, owner_id = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        data.title ?? existing.title,
        nextNotes !== undefined ? nextNotes : existing.notes,
        nextDueDate !== undefined ? nextDueDate : existing.dueDate,
        data.status ?? existing.status,
        nextScheduledDate !== undefined
            ? nextScheduledDate
            : existing.scheduledDate,
        data.scheduledOrder !== undefined
            ? nextScheduledOrder
            : existing.scheduledOrder,
        data.locked !== undefined ? (data.locked ? 1 : 0) : (existing.locked ? 1 : 0),
        data.ownerId !== undefined ? data.ownerId : existing.ownerId,
        now,
        id,
      );
    return this.findById(id, userId);
  }

  async deleteAsync(id: string, userId?: number): Promise<void> {
    if (env.dbClient === 'postgres') {
      await this.findByIdAsync(id, userId);
      const result = await getPostgresPool().query(
        'DELETE FROM tasks WHERE id = $1',
        [id],
      );
      if ((result.rowCount ?? 0) === 0) throw AppError.notFound('Task');
      return;
    }

    this.delete(id, userId);
  }

  delete(id: string, userId?: number): void {
    this.findById(id, userId);
    const result = getDb().prepare('DELETE FROM tasks WHERE id = ?').run(id);
    if (result.changes === 0) throw AppError.notFound('Task');
  }
}
