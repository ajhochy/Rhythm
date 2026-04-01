import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../database/db';
import { AppError } from '../errors/app_error';
import type { CreateTaskDto, Task, UpdateTaskDto } from '../models/task';

interface TaskRow {
  id: string;
  title: string;
  notes: string | null;
  due_date: string | null;
  scheduled_date: string | null;
  locked: number;
  status: string;
  source_type: string | null;
  source_id: string | null;
  owner_id: number | null;
  created_at: string;
  updated_at: string;
}

function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    notes: row.notes ?? null,
    dueDate: row.due_date,
    scheduledDate: row.scheduled_date ?? null,
    locked: row.locked === 1,
    status: row.status as Task['status'],
    sourceType: row.source_type,
    sourceId: row.source_id,
    sourceName: null,
    ownerId: row.owner_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class TasksRepository {
  findAll(userId?: number): Task[] {
    if (userId != null) {
      const rows = getDb()
        .prepare(
          `SELECT * FROM tasks
           WHERE owner_id = ? OR owner_id IS NULL
           ORDER BY due_date ASC, created_at ASC`,
        )
        .all(userId) as TaskRow[];
      return rows.map(rowToTask);
    }
    const rows = getDb()
      .prepare('SELECT * FROM tasks ORDER BY due_date ASC, created_at ASC')
      .all() as TaskRow[];
    return rows.map(rowToTask);
  }

  findById(id: string, userId?: number): Task {
    const row = (userId != null
      ? getDb()
          .prepare(
            'SELECT * FROM tasks WHERE id = ? AND (owner_id = ? OR owner_id IS NULL)',
          )
          .get(id, userId)
      : getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(id)) as
      | TaskRow
      | undefined;
    if (!row) throw AppError.notFound('Task');
    return rowToTask(row);
  }

  findBySource(sourceType: string, sourceId: string): Task | null {
    const row = getDb()
      .prepare('SELECT * FROM tasks WHERE source_type = ? AND source_id = ? LIMIT 1')
      .get(sourceType, sourceId) as TaskRow | undefined;
    return row ? rowToTask(row) : null;
  }

  findByWeek(weekStart: string, weekEnd: string, userId?: number): Task[] {
    if (userId != null) {
      const rows = getDb()
        .prepare(
          `SELECT * FROM tasks
           WHERE (owner_id = ? OR owner_id IS NULL)
             AND (due_date BETWEEN ? AND ? OR scheduled_date BETWEEN ? AND ?)
           ORDER BY due_date ASC, created_at ASC`,
        )
        .all(userId, weekStart, weekEnd, weekStart, weekEnd) as TaskRow[];
      return rows.map(rowToTask);
    }
    const rows = getDb()
      .prepare(
        `SELECT * FROM tasks
         WHERE (due_date BETWEEN ? AND ? OR scheduled_date BETWEEN ? AND ?)
         ORDER BY due_date ASC, created_at ASC`,
      )
      .all(weekStart, weekEnd, weekStart, weekEnd) as TaskRow[];
    return rows.map(rowToTask);
  }

  create(data: CreateTaskDto): Task {
    const id = uuidv4();
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO tasks (
          id, title, notes, due_date, scheduled_date, locked, status,
          source_type, source_id, owner_id, created_at, updated_at
        )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        data.title,
        data.notes ?? null,
        data.dueDate ?? null,
        data.scheduledDate ?? null,
        data.locked ? 1 : 0,
        data.status ?? 'open',
        data.sourceType ?? null,
        data.sourceId ?? null,
        data.ownerId ?? null,
        now,
        now,
      );
    return this.findById(id);
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
      status: data.status ?? 'open',
      locked: data.locked ?? existing.locked,
    });
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

  deleteFutureOpenBySourceId(sourceType: string, sourceId: string): number {
    const today = new Date().toISOString().substring(0, 10);
    const result = getDb()
      .prepare(
        `DELETE FROM tasks WHERE source_type = ? AND source_id = ? AND status = 'open' AND (due_date IS NULL OR due_date >= ?)`,
      )
      .run(sourceType, sourceId, today);
    return result.changes;
  }

  deleteAllBySourceType(sourceType: string): number {
    const result = getDb()
      .prepare('DELETE FROM tasks WHERE source_type = ?')
      .run(sourceType);
    return result.changes;
  }

  update(id: string, data: UpdateTaskDto, userId?: number): Task {
    const existing = this.findById(id, userId);
    const now = new Date().toISOString();
    const nextNotes = data.notes === '' ? null : data.notes;
    const nextDueDate = data.dueDate === '' ? null : data.dueDate;
    const nextScheduledDate =
      data.scheduledDate === '' ? null : data.scheduledDate;
    getDb()
      .prepare(
        `UPDATE tasks
         SET title = ?, notes = ?, due_date = ?, status = ?,
             scheduled_date = ?, locked = ?, owner_id = ?, updated_at = ?
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
        data.locked !== undefined ? (data.locked ? 1 : 0) : (existing.locked ? 1 : 0),
        data.ownerId !== undefined ? data.ownerId : existing.ownerId,
        now,
        id,
      );
    return this.findById(id, userId);
  }

  delete(id: string, userId?: number): void {
    this.findById(id, userId);
    const result = getDb().prepare('DELETE FROM tasks WHERE id = ?').run(id);
    if (result.changes === 0) throw AppError.notFound('Task');
  }
}
