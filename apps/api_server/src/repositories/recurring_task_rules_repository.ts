import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../database/db';
import { AppError } from '../errors/app_error';
import type {
  CreateRecurringTaskRuleDto,
  RecurringTaskRule,
  UpdateRecurringTaskRuleDto,
} from '../models/recurring_task_rule';

interface RuleRow {
  id: string;
  title: string;
  frequency: string;
  day_of_week: number | null;
  day_of_month: number | null;
  month: number | null;
  created_at: string;
}

function rowToRule(row: RuleRow): RecurringTaskRule {
  return {
    id: row.id,
    title: row.title,
    frequency: row.frequency as RecurringTaskRule['frequency'],
    dayOfWeek: row.day_of_week,
    dayOfMonth: row.day_of_month,
    month: row.month,
    createdAt: row.created_at,
  };
}

export class RecurringTaskRulesRepository {
  findAll(): RecurringTaskRule[] {
    const rows = getDb()
      .prepare('SELECT * FROM recurring_task_rules ORDER BY created_at ASC')
      .all() as RuleRow[];
    return rows.map(rowToRule);
  }

  findById(id: string): RecurringTaskRule {
    const row = getDb()
      .prepare('SELECT * FROM recurring_task_rules WHERE id = ?')
      .get(id) as RuleRow | undefined;
    if (!row) throw AppError.notFound('RecurringTaskRule');
    return rowToRule(row);
  }

  create(data: CreateRecurringTaskRuleDto): RecurringTaskRule {
    const id = uuidv4();
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO recurring_task_rules (id, title, frequency, day_of_week, day_of_month, month, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        data.title,
        data.frequency,
        data.dayOfWeek ?? null,
        data.dayOfMonth ?? null,
        data.month ?? null,
        now,
      );
    return this.findById(id);
  }

  update(id: string, data: UpdateRecurringTaskRuleDto): RecurringTaskRule {
    const existing = this.findById(id);
    getDb()
      .prepare(
        `UPDATE recurring_task_rules
         SET title = ?, frequency = ?, day_of_week = ?, day_of_month = ?, month = ?
         WHERE id = ?`,
      )
      .run(
        data.title ?? existing.title,
        data.frequency ?? existing.frequency,
        data.dayOfWeek !== undefined ? data.dayOfWeek : existing.dayOfWeek,
        data.dayOfMonth !== undefined ? data.dayOfMonth : existing.dayOfMonth,
        data.month !== undefined ? data.month : existing.month,
        id,
      );
    return this.findById(id);
  }

  delete(id: string): void {
    const result = getDb().prepare('DELETE FROM recurring_task_rules WHERE id = ?').run(id);
    if (result.changes === 0) throw AppError.notFound('RecurringTaskRule');
  }
}
