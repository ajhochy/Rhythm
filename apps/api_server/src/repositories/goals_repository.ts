import { env } from '../config/env';
import { getDb, getPostgresPool } from '../database/db';
import { AppError } from '../errors/app_error';
import type { CreateGoalDto, Goal, UpdateGoalDto } from '../models/goal';

interface GoalRow {
  id: string;
  title: string;
  description: string | null;
  metric_type: Goal['metricType'];
  start_value: number | string;
  current_value: number | string;
  end_value: number | string;
  health: Goal['health'];
  start_date: string;
  end_date: string;
  owner_id: number;
  created_at: string;
  updated_at: string;
}

function rowToGoal(row: GoalRow): Goal {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? null,
    metricType: row.metric_type,
    startValue: Number(row.start_value),
    currentValue: Number(row.current_value),
    endValue: Number(row.end_value),
    health: row.health,
    startDate: row.start_date,
    endDate: row.end_date,
    ownerId: row.owner_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class GoalsRepository {
  async findAllAsync(ownerId: number): Promise<Goal[]> {
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query<GoalRow>(
        'SELECT * FROM goals WHERE owner_id = $1 ORDER BY start_date DESC, created_at DESC',
        [ownerId],
      );
      return result.rows.map(rowToGoal);
    }
    return this.findAll(ownerId);
  }

  findAll(ownerId: number): Goal[] {
    return (getDb().prepare(
      'SELECT * FROM goals WHERE owner_id = ? ORDER BY start_date DESC, created_at DESC',
    ).all(ownerId) as GoalRow[]).map(rowToGoal);
  }

  async findByIdAsync(id: string, ownerId: number): Promise<Goal> {
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query<GoalRow>(
        'SELECT * FROM goals WHERE id = $1 AND owner_id = $2', [id, ownerId],
      );
      if (!result.rows[0]) throw AppError.notFound('Goal');
      return rowToGoal(result.rows[0]);
    }
    return this.findById(id, ownerId);
  }

  findById(id: string, ownerId: number): Goal {
    const row = getDb().prepare(
      'SELECT * FROM goals WHERE id = ? AND owner_id = ?',
    ).get(id, ownerId) as GoalRow | undefined;
    if (!row) throw AppError.notFound('Goal');
    return rowToGoal(row);
  }

  async createAsync(data: CreateGoalDto): Promise<Goal> {
    if (env.dbClient === 'postgres') {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      await getPostgresPool().query(
        `INSERT INTO goals (id, title, description, metric_type, start_value, current_value,
          end_value, health, start_date, end_date, owner_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [id, data.title, data.description ?? null, data.metricType, data.startValue,
          data.currentValue, data.endValue, data.health ?? 'on_track', data.startDate,
          data.endDate, data.ownerId, now, now],
      );
      return this.findByIdAsync(id, data.ownerId);
    }
    return this.create(data);
  }

  create(data: CreateGoalDto): Goal {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    getDb().prepare(
      `INSERT INTO goals (id, title, description, metric_type, start_value, current_value,
        end_value, health, start_date, end_date, owner_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, data.title, data.description ?? null, data.metricType, data.startValue,
      data.currentValue, data.endValue, data.health ?? 'on_track', data.startDate,
      data.endDate, data.ownerId, now, now);
    return this.findById(id, data.ownerId);
  }

  async updateAsync(id: string, data: UpdateGoalDto, ownerId: number): Promise<Goal> {
    const existing = await this.findByIdAsync(id, ownerId);
    const next = { ...existing, ...data, updatedAt: new Date().toISOString() };
    if (env.dbClient === 'postgres') {
      await getPostgresPool().query(
        `UPDATE goals SET title = $1, description = $2, metric_type = $3,
          start_value = $4, current_value = $5, end_value = $6, health = $7,
          start_date = $8, end_date = $9, updated_at = $10
         WHERE id = $11 AND owner_id = $12`,
        [next.title, next.description, next.metricType, next.startValue, next.currentValue,
          next.endValue, next.health, next.startDate, next.endDate, next.updatedAt, id, ownerId],
      );
      return this.findByIdAsync(id, ownerId);
    }
    return this.update(id, data, ownerId);
  }

  update(id: string, data: UpdateGoalDto, ownerId: number): Goal {
    const existing = this.findById(id, ownerId);
    const next = { ...existing, ...data, updatedAt: new Date().toISOString() };
    getDb().prepare(
      `UPDATE goals SET title = ?, description = ?, metric_type = ?, start_value = ?,
        current_value = ?, end_value = ?, health = ?, start_date = ?, end_date = ?, updated_at = ?
       WHERE id = ? AND owner_id = ?`,
    ).run(next.title, next.description, next.metricType, next.startValue, next.currentValue,
      next.endValue, next.health, next.startDate, next.endDate, next.updatedAt, id, ownerId);
    return this.findById(id, ownerId);
  }

  async deleteAsync(id: string, ownerId: number): Promise<void> {
    await this.findByIdAsync(id, ownerId);
    if (env.dbClient === 'postgres') {
      await getPostgresPool().query('DELETE FROM goals WHERE id = $1 AND owner_id = $2', [id, ownerId]);
      return;
    }
    getDb().prepare('DELETE FROM goals WHERE id = ? AND owner_id = ?').run(id, ownerId);
  }
}
