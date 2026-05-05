import type { RecurringTaskRule, RecurringTaskRuleStep } from '../models/recurring_task_rule';
import type { Task } from '../models/task';
import { TasksRepository } from '../repositories/tasks_repository';

export class RecurrenceService {
  private readonly tasksRepo = new TasksRepository();

  /**
   * Generate concrete task instances for a recurring rule within [from, to].
   * Idempotent: skips dates where a task with matching source_type/source_id/due_date already exists.
   *
   * When a rule has workflow steps, each step gets its own due date computed from
   * the step's per-step day fields (dayOfWeek / dayOfMonth / month), falling back
   * to the rhythm-level fields when a step's field is null.
   *
   * When a rule has zero steps, behavior is unchanged: one task per occurrence date.
   */
  async generateInstances(
    rule: RecurringTaskRule,
    from: Date,
    to: Date,
  ): Promise<Task[]> {
    if (rule.ownerId == null) return [];

    const hasWorkflowSteps = rule.steps.length > 0;
    const created: Task[] = [];

    if (!hasWorkflowSteps) {
      // Legacy / no-step path: one task per occurrence date using rhythm-level fields.
      const dates = this.computeDates(rule, from, to);
      for (const date of dates) {
        const dateStr = toDateStr(date);
        const existing = await this.tasksRepo.findBySourceAndDueDateAsync(
          'recurring_rule',
          rule.id,
          dateStr,
        );
        if (!existing) {
          const task = await this.tasksRepo.createAsync({
            title: rule.title,
            dueDate: dateStr,
            status: 'open',
            sourceType: 'recurring_rule',
            sourceId: rule.id,
            ownerId: rule.ownerId,
            scheduledOrder: null,
            locked: false,
          });
          created.push(task);
        }
      }
      return created;
    }

    // Per-step path: iterate over periods (week/month/year) and compute each
    // step's due date within that period.
    switch (rule.frequency) {
      case 'weekly':
        created.push(...(await this.generateWeeklyPerStep(rule, from, to)));
        break;
      case 'monthly':
        created.push(...(await this.generateMonthlyPerStep(rule, from, to)));
        break;
      case 'annual':
        created.push(...(await this.generateAnnualPerStep(rule, from, to)));
        break;
    }

    return created;
  }

  // ---------------------------------------------------------------------------
  // Per-step generation helpers
  // ---------------------------------------------------------------------------

  /**
   * Weekly: iterate over each week in [from, to].
   * For each step, compute its date in that week from step.dayOfWeek (fallback: rule.dayOfWeek).
   * Week reference = Sunday of the week containing `from`.
   */
  private async generateWeeklyPerStep(
    rule: RecurringTaskRule,
    from: Date,
    to: Date,
  ): Promise<Task[]> {
    const created: Task[] = [];
    const fromMidnight = utcMidnight(from);

    // Find the Sunday of the week that contains `from`.
    const weekStart = new Date(fromMidnight);
    weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay());

    while (weekStart <= to) {
      for (const [index, step] of rule.steps.entries()) {
        const targetDow = step.dayOfWeek ?? rule.dayOfWeek ?? 1; // default Monday
        const date = new Date(weekStart);
        date.setUTCDate(date.getUTCDate() + targetDow);

        // Skip dates outside [from, to].
        if (date < fromMidnight || date > to) continue;

        const taskCreated = await this.createStepTaskIfMissing(
          rule,
          step,
          index,
          date,
        );
        if (taskCreated) created.push(taskCreated);
      }
      weekStart.setUTCDate(weekStart.getUTCDate() + 7);
    }

    return created;
  }

  /**
   * Monthly: iterate over each month in [from, to].
   * For each step, compute its date using resolveMonthDay with step.dayOfMonth (fallback: rule.dayOfMonth).
   */
  private async generateMonthlyPerStep(
    rule: RecurringTaskRule,
    from: Date,
    to: Date,
  ): Promise<Task[]> {
    const created: Task[] = [];
    const fromMidnight = utcMidnight(from);

    let year = from.getUTCFullYear();
    let month = from.getUTCMonth();

    // Keep iterating months while there is any chance a step date falls in [from, to].
    // We stop when the first possible date in the month (day 1) already exceeds `to`.
    while (new Date(Date.UTC(year, month, 1)) <= to) {
      for (const [index, step] of rule.steps.entries()) {
        const dayOfMonth = step.dayOfMonth ?? rule.dayOfMonth ?? 1;
        const date = resolveMonthDay(year, month, dayOfMonth);

        if (date < fromMidnight || date > to) continue;

        const taskCreated = await this.createStepTaskIfMissing(
          rule,
          step,
          index,
          date,
        );
        if (taskCreated) created.push(taskCreated);
      }

      month++;
      if (month > 11) {
        month = 0;
        year++;
      }
    }

    return created;
  }

  /**
   * Annual: iterate over each year in [from, to].
   * Each step may land on a DIFFERENT month because each step carries its own `month`.
   * Date = resolveMonthDay(year, (step.month ?? rule.month) - 1, step.dayOfMonth ?? rule.dayOfMonth).
   */
  private async generateAnnualPerStep(
    rule: RecurringTaskRule,
    from: Date,
    to: Date,
  ): Promise<Task[]> {
    const created: Task[] = [];
    const fromMidnight = utcMidnight(from);

    for (let year = from.getUTCFullYear(); year <= to.getUTCFullYear(); year++) {
      for (const [index, step] of rule.steps.entries()) {
        const stepMonth = (step.month ?? rule.month ?? 1) - 1; // 1-indexed → 0-indexed
        const dayOfMonth = step.dayOfMonth ?? rule.dayOfMonth ?? 1;
        const date = resolveMonthDay(year, stepMonth, dayOfMonth);

        if (date < fromMidnight || date > to) continue;

        const taskCreated = await this.createStepTaskIfMissing(
          rule,
          step,
          index,
          date,
        );
        if (taskCreated) created.push(taskCreated);
      }
    }

    return created;
  }

  // ---------------------------------------------------------------------------
  // Shared helper: create one step task if it doesn't already exist.
  // ---------------------------------------------------------------------------

  private async createStepTaskIfMissing(
    rule: RecurringTaskRule,
    step: RecurringTaskRuleStep,
    index: number,
    date: Date,
  ): Promise<Task | null> {
    const sourceId = `${rule.id}:${step.id}`;
    const dateStr = toDateStr(date);

    const existing = await this.tasksRepo.findBySourceAndDueDateAsync(
      'recurring_rule',
      sourceId,
      dateStr,
    );
    if (existing) return null;

    const locked = rule.sequential && index > 0;
    return this.tasksRepo.createAsync({
      title: step.title,
      dueDate: dateStr,
      status: 'open',
      sourceType: 'recurring_rule',
      sourceId,
      ownerId: step.assigneeId ?? rule.ownerId!,
      scheduledOrder: (index + 1) * 10000,
      locked,
    });
  }

  // ---------------------------------------------------------------------------
  // Legacy single-occurrence date helpers (used by the no-step path)
  // ---------------------------------------------------------------------------

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

export function resolveMonthDay(year: number, month: number, day: number): Date {
  // Last day of the given month (handles month-end overflow and leap years)
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, lastDay)));
}

function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0];
}
