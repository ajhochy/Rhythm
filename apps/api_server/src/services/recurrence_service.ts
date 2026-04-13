import type { RecurringTaskRule } from '../models/recurring_task_rule';
import type { Task } from '../models/task';
import { TasksRepository } from '../repositories/tasks_repository';

export class RecurrenceService {
  private readonly tasksRepo = new TasksRepository();

  /**
   * Generate concrete task instances for a recurring rule within [from, to].
   * Idempotent: skips dates where a task with matching source_type/source_id/due_date already exists.
   */
  async generateInstances(
    rule: RecurringTaskRule,
    from: Date,
    to: Date,
  ): Promise<Task[]> {
    const dates = this.computeDates(rule, from, to);
    const created: Task[] = [];
    const hasWorkflowSteps = rule.steps.length > 0;

    for (const date of dates) {
      const dateStr = toDateStr(date);
      const steps = hasWorkflowSteps
        ? rule.steps
        : [{ id: rule.id, title: rule.title, assigneeId: rule.ownerId }];

      for (const [index, step] of steps.entries()) {
        const sourceId = hasWorkflowSteps ? `${rule.id}:${step.id}` : rule.id;
        const existing = await this.tasksRepo.findBySourceAndDueDateAsync(
          'recurring_rule',
          sourceId,
          dateStr,
        );

        if (!existing) {
          const task = await this.tasksRepo.createAsync({
            title: step.title,
            dueDate: dateStr,
            status: 'open',
            sourceType: 'recurring_rule',
            sourceId,
            ownerId: step.assigneeId ?? rule.ownerId,
            scheduledOrder: hasWorkflowSteps ? (index + 1) * 10000 : null,
          });
          created.push(task);
        }
      }
    }

    return created;
  }

  private computeDates(rule: RecurringTaskRule, from: Date, to: Date): Date[] {
    switch (rule.frequency) {
      case 'weekly':
        return this.weeklyDates(rule, from, to);
      case 'monthly':
        return this.monthlyDates(rule, from, to);
      case 'annual':
        return this.annualDates(rule, from, to);
    }
  }

  private weeklyDates(rule: RecurringTaskRule, from: Date, to: Date): Date[] {
    const targetDow = rule.dayOfWeek ?? 1; // default Monday
    const results: Date[] = [];
    const cur = utcMidnight(from);

    // Advance to the first matching day of week
    const diff = (targetDow - cur.getUTCDay() + 7) % 7;
    cur.setUTCDate(cur.getUTCDate() + diff);

    while (cur <= to) {
      results.push(new Date(cur));
      cur.setUTCDate(cur.getUTCDate() + 7);
    }
    return results;
  }

  private monthlyDates(rule: RecurringTaskRule, from: Date, to: Date): Date[] {
    const dayOfMonth = rule.dayOfMonth ?? 1;
    const results: Date[] = [];

    let year = from.getUTCFullYear();
    let month = from.getUTCMonth();

    while (true) {
      const date = resolveMonthDay(year, month, dayOfMonth);
      if (date > to) break;
      if (date >= utcMidnight(from)) results.push(date);
      month++;
      if (month > 11) {
        month = 0;
        year++;
      }
    }
    return results;
  }

  private annualDates(rule: RecurringTaskRule, from: Date, to: Date): Date[] {
    const month = (rule.month ?? 1) - 1; // 1-indexed → 0-indexed
    const dayOfMonth = rule.dayOfMonth ?? 1;
    const results: Date[] = [];

    for (let year = from.getUTCFullYear(); year <= to.getUTCFullYear(); year++) {
      const date = resolveMonthDay(year, month, dayOfMonth);
      if (date >= utcMidnight(from) && date <= to) results.push(date);
    }
    return results;
  }
}

function utcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function resolveMonthDay(year: number, month: number, day: number): Date {
  // Last day of the given month (handles month-end overflow and leap years)
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, lastDay)));
}

function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0];
}
