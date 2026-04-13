import { env } from '../config/env';
import { v4 as uuidv4 } from 'uuid';
import { getDb, getPostgresPool } from '../database/db';
import { AppError } from '../errors/app_error';
import type {
  CreateRecurringTaskRuleDto,
  RecurringTaskRule,
  RecurringTaskRuleStep,
  UpdateRecurringTaskRuleDto,
} from '../models/recurring_task_rule';

interface RuleRow {
  id: string;
  title: string;
  frequency: string;
  day_of_week: number | null;
  day_of_month: number | null;
  month: number | null;
  steps_json: string | null;
  enabled: number | boolean;
  owner_id: number | null;
  created_at: string;
}

function rowToRule(row: RuleRow): RecurringTaskRule {
  const enabled =
    typeof row.enabled === 'boolean' ? row.enabled : row.enabled === 1;
  return {
    id: row.id,
    title: row.title,
    frequency: row.frequency as RecurringTaskRule['frequency'],
    dayOfWeek: row.day_of_week,
    dayOfMonth: row.day_of_month,
    month: row.month,
    enabled,
    ownerId: row.owner_id,
    steps: parseSteps(row.steps_json),
    createdAt: row.created_at,
  };
}

function parseSteps(raw: string | null): RecurringTaskRuleStep[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((step, index) => normalizeStep(step, index))
      .filter((step): step is RecurringTaskRuleStep => step != null);
  } catch {
    return [];
  }
}

function normalizeStep(step: unknown, fallbackIndex: number): RecurringTaskRuleStep | null {
  if (step == null || typeof step !== 'object') return null;
  const record = step as Record<string, unknown>;
  const title = typeof record.title === 'string' ? record.title.trim() : '';
  if (!title) return null;
  const id =
    typeof record.id === 'string' && record.id.trim().length > 0
      ? record.id.trim()
      : `step-${fallbackIndex + 1}-${uuidv4()}`;
  const assigneeId =
    typeof record.assigneeId === 'number'
      ? record.assigneeId
      : typeof record.assigneeId === 'string' && record.assigneeId.trim() !== ''
        ? Number(record.assigneeId)
        : null;
  return {
    id,
    title,
    assigneeId: Number.isFinite(assigneeId as number) ? (assigneeId as number) : null,
    assigneeName: typeof record.assigneeName === 'string' ? record.assigneeName : null,
  };
}

function serializeSteps(steps?: RecurringTaskRuleStep[]): string {
  return JSON.stringify(
    (steps ?? []).map((step, index) => ({
      id: step.id.trim().length > 0 ? step.id.trim() : `step-${index + 1}-${uuidv4()}`,
      title: step.title.trim(),
      assigneeId: step.assigneeId ?? null,
    })),
  );
}

export class RecurringTaskRulesRepository {
  async findAllAsync(userId?: number): Promise<RecurringTaskRule[]> {
    if (env.dbClient === 'postgres') {
      const result =
        userId != null
          ? await getPostgresPool().query<RuleRow>(
              `SELECT * FROM recurring_task_rules
               WHERE owner_id = $1 OR owner_id IS NULL
               ORDER BY created_at ASC`,
              [userId],
            )
          : await getPostgresPool().query<RuleRow>(
              'SELECT * FROM recurring_task_rules ORDER BY created_at ASC',
            );
      return result.rows.map(rowToRule);
    }
    return this.findAll(userId);
  }

  findAll(userId?: number): RecurringTaskRule[] {
    if (userId != null) {
      const rows = getDb()
        .prepare(
          `SELECT * FROM recurring_task_rules
           WHERE owner_id = ? OR owner_id IS NULL
           ORDER BY created_at ASC`,
        )
        .all(userId) as RuleRow[];
      return rows.map(rowToRule);
    }
    const rows = getDb()
      .prepare('SELECT * FROM recurring_task_rules ORDER BY created_at ASC')
      .all() as RuleRow[];
    return rows.map(rowToRule);
  }

  async findByIdAsync(id: string, userId?: number): Promise<RecurringTaskRule> {
    if (env.dbClient === 'postgres') {
      const result =
        userId != null
          ? await getPostgresPool().query<RuleRow>(
              `SELECT * FROM recurring_task_rules
               WHERE id = $1 AND (owner_id = $2 OR owner_id IS NULL)`,
              [id, userId],
            )
          : await getPostgresPool().query<RuleRow>(
              'SELECT * FROM recurring_task_rules WHERE id = $1',
              [id],
            );
      const row = result.rows[0];
      if (!row) throw AppError.notFound('RecurringTaskRule');
      return rowToRule(row);
    }
    return this.findById(id, userId);
  }

  findById(id: string, userId?: number): RecurringTaskRule {
    const row = (userId != null
      ? getDb()
          .prepare(
            `SELECT * FROM recurring_task_rules
             WHERE id = ? AND (owner_id = ? OR owner_id IS NULL)`,
          )
          .get(id, userId)
      : getDb()
          .prepare('SELECT * FROM recurring_task_rules WHERE id = ?')
          .get(id)) as RuleRow | undefined;
    if (!row) throw AppError.notFound('RecurringTaskRule');
    return rowToRule(row);
  }

  async createAsync(
    data: CreateRecurringTaskRuleDto,
  ): Promise<RecurringTaskRule> {
    if (env.dbClient === 'postgres') {
      const id = uuidv4();
      const now = new Date().toISOString();
      await getPostgresPool().query(
        `INSERT INTO recurring_task_rules (id, title, frequency, day_of_week, day_of_month, month, steps_json, enabled, owner_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          id,
          data.title,
          data.frequency,
          data.dayOfWeek ?? null,
          data.dayOfMonth ?? null,
          data.month ?? null,
          serializeSteps(data.steps),
          data.enabled !== false,
          data.ownerId ?? null,
          now,
        ],
      );
      return this.findByIdAsync(id);
    }
    return this.create(data);
  }

  create(data: CreateRecurringTaskRuleDto): RecurringTaskRule {
    const id = uuidv4();
    const now = new Date().toISOString();
    const enabled = data.enabled !== false ? 1 : 0;
    getDb()
      .prepare(
        `INSERT INTO recurring_task_rules (id, title, frequency, day_of_week, day_of_month, month, steps_json, enabled, owner_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        data.title,
        data.frequency,
        data.dayOfWeek ?? null,
        data.dayOfMonth ?? null,
        data.month ?? null,
        serializeSteps(data.steps),
        enabled,
        data.ownerId ?? null,
        now,
      );
    return this.findById(id);
  }

  async updateAsync(
    id: string,
    data: UpdateRecurringTaskRuleDto,
    userId?: number,
  ): Promise<RecurringTaskRule> {
    if (env.dbClient === 'postgres') {
      const existing = await this.findByIdAsync(id, userId);
      const steps = data.steps !== undefined ? data.steps : existing.steps;
      await getPostgresPool().query(
        `UPDATE recurring_task_rules
         SET title = $1, frequency = $2, day_of_week = $3, day_of_month = $4, month = $5, steps_json = $6, enabled = $7, owner_id = $8
         WHERE id = $9`,
        [
          data.title ?? existing.title,
          data.frequency ?? existing.frequency,
          data.dayOfWeek !== undefined ? data.dayOfWeek : existing.dayOfWeek,
          data.dayOfMonth !== undefined ? data.dayOfMonth : existing.dayOfMonth,
          data.month !== undefined ? data.month : existing.month,
          serializeSteps(steps),
          data.enabled !== undefined ? data.enabled : existing.enabled,
          data.ownerId !== undefined ? data.ownerId : existing.ownerId,
          id,
        ],
      );
      return this.findByIdAsync(id, userId);
    }
    return this.update(id, data, userId);
  }

  update(
    id: string,
    data: UpdateRecurringTaskRuleDto,
    userId?: number,
  ): RecurringTaskRule {
    const existing = this.findById(id, userId);
    const enabled = data.enabled !== undefined ? (data.enabled ? 1 : 0) : (existing.enabled ? 1 : 0);
    const steps =
      data.steps !== undefined ? data.steps : existing.steps;
    getDb()
      .prepare(
        `UPDATE recurring_task_rules
         SET title = ?, frequency = ?, day_of_week = ?, day_of_month = ?, month = ?, steps_json = ?, enabled = ?, owner_id = ?
         WHERE id = ?`,
      )
      .run(
        data.title ?? existing.title,
        data.frequency ?? existing.frequency,
        data.dayOfWeek !== undefined ? data.dayOfWeek : existing.dayOfWeek,
        data.dayOfMonth !== undefined ? data.dayOfMonth : existing.dayOfMonth,
        data.month !== undefined ? data.month : existing.month,
        serializeSteps(steps),
        enabled,
        data.ownerId !== undefined ? data.ownerId : existing.ownerId,
        id,
      );
    return this.findById(id, userId);
  }

  async deleteAsync(id: string, userId?: number): Promise<void> {
    if (env.dbClient === 'postgres') {
      await this.findByIdAsync(id, userId);
      const result = await getPostgresPool().query(
        'DELETE FROM recurring_task_rules WHERE id = $1',
        [id],
      );
      if (result.rowCount === 0) throw AppError.notFound('RecurringTaskRule');
      return;
    }
    this.delete(id, userId);
  }

  delete(id: string, userId?: number): void {
    this.findById(id, userId);
    const result = getDb().prepare('DELETE FROM recurring_task_rules WHERE id = ?').run(id);
    if (result.changes === 0) throw AppError.notFound('RecurringTaskRule');
  }
}
