import type { TaskStatus } from '../models/task';

/** Minimal task shape accepted by the date-status predicates.
 *  Intentionally narrower than the full Task interface to avoid tight coupling. */
export interface TaskDateShape {
  status: TaskStatus;
  scheduledDate?: string | null;
  dueDate?: string | null;
}

/**
 * Returns the canonical "priority date" for a task: scheduledDate takes
 * precedence over dueDate. Date strings must be in YYYY-MM-DD format.
 * Returns null when neither date is set.
 */
export function priorityDate(task: Pick<TaskDateShape, 'scheduledDate' | 'dueDate'>): Date | null {
  const raw = task.scheduledDate ?? task.dueDate;
  if (!raw) return null;
  return new Date(raw + 'T00:00:00');
}

/**
 * A task is overdue when:
 *   - status is not 'done', AND
 *   - COALESCE(scheduledDate, dueDate) is set and is strictly before today.
 *
 * @param task  Minimal task shape with status and optional date fields.
 * @param today The reference date to compare against (caller-supplied; do NOT
 *              call new Date() internally so that tests can pin time).
 */
export function isOverdue(task: TaskDateShape, today: Date): boolean {
  if (task.status === 'done') return false;
  const d = priorityDate(task);
  return d !== null && d < today;
}

/**
 * A task is past its hard deadline when:
 *   - status is not 'done', AND
 *   - dueDate is set and is strictly before today.
 *
 * Note: this ignores scheduledDate — it only looks at the dueDate field,
 * which represents the latest acceptable completion date regardless of
 * when the work is actually scheduled.
 *
 * @param task  Minimal task shape with status and optional date fields.
 * @param today The reference date to compare against.
 */
export function isPastDeadline(task: TaskDateShape, today: Date): boolean {
  if (task.status === 'done') return false;
  if (!task.dueDate) return false;
  const d = new Date(task.dueDate + 'T00:00:00');
  return d < today;
}

/** Convenience object returned by taskDateStatus. */
export interface TaskDateStatusResult {
  overdue: boolean;
  pastDeadline: boolean;
  priorityDate: Date | null;
}

/**
 * Returns a structured result describing the date status of a task.
 * Useful when callers need multiple flags at once without re-parsing dates.
 */
export function taskDateStatus(task: TaskDateShape, today: Date): TaskDateStatusResult {
  return {
    overdue: isOverdue(task, today),
    pastDeadline: isPastDeadline(task, today),
    priorityDate: priorityDate(task),
  };
}
