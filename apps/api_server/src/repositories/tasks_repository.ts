import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../database/db';
import { AppError } from '../errors/app_error';
import type { CreateTaskDto, Task, UpdateTaskDto } from '../models/task';

interface TaskRow {
  id: string;
  title: string;
  due_date: string | null;
  scheduled_date: string | null;
  locked: number;
  status: string;
  source_type: string | null;
  source_id: string | null;
  created_at: string;
  updated_at: string;
}

function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    dueDate: row.due_date,
    scheduledDate: row.scheduled_date ?? null,
    locked: row.locked === 1,
    status: row.status as Task['status'],
    sourceType: row.source_type,
    sourceId: row.source_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class TasksRepository {
  findAll(): Task[] {
    const rows = getDb().prepare('SELECT * FROM tasks ORDER BY due_date ASC, created_at ASC').all() as TaskRow[];
    return rows.map(rowToTask);
  }

  findById(id: string): Task {
    const row = getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined;
    if (!row) throw AppError.notFound('Task');
    return rowToTask(row);
  }

  findByWeek(weekStart: string, weekEnd: string): Task[] {
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
        `INSERT INTO tasks (id, title, due_date, status, source_type, source_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, data.title, data.dueDate ?? null, data.status ?? 'open', data.sourceType ?? null, data.sourceId ?? null, now, now);
    return this.findById(id);
  }

  update(id: string, data: UpdateTaskDto): Task {
    const existing = this.findById(id);
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `UPDATE tasks SET title = ?, due_date = ?, status = ?, scheduled_date = ?, locked = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        data.title ?? existing.title,
        data.dueDate !== undefined ? data.dueDate : existing.dueDate,
        data.status ?? existing.status,
        data.scheduledDate !== undefined ? data.scheduledDate : existing.scheduledDate,
        data.locked !== undefined ? (data.locked ? 1 : 0) : (existing.locked ? 1 : 0),
        now,
        id,
      );
    return this.findById(id);
  }

  delete(id: string): void {
    const result = getDb().prepare('DELETE FROM tasks WHERE id = ?').run(id);
    if (result.changes === 0) throw AppError.notFound('Task');
  }
}
