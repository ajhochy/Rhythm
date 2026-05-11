import { CalendarShadowEventsRepository } from '../repositories/calendar_shadow_events_repository';
import { ProjectInstancesRepository } from '../repositories/project_instances_repository';
import { TasksRepository } from '../repositories/tasks_repository';
import type { Task } from '../models/task';
import { priorityDate } from './task_date_status';

export interface WeeklyPlanDay {
  date: string;
  tasks: Task[];
}

export interface WeeklyPlan {
  weekLabel: string;
  weekStart: string;
  days: WeeklyPlanDay[];
  backlog: Task[];
}

/** Parse a YYYY-WNN label into the Monday UTC date for that ISO week. */
export function parseWeekLabel(weekLabel: string): Date {
  const m = weekLabel.match(/^(\d{4})-W(\d{1,2})$/);
  if (!m) throw new Error(`Invalid week label: ${weekLabel}`);
  const year = parseInt(m[1], 10);
  const week = parseInt(m[2], 10);
  // Jan 4 is always in ISO week 1
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const mondayWeek1 = new Date(jan4);
  mondayWeek1.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7));
  const result = new Date(mondayWeek1);
  result.setUTCDate(mondayWeek1.getUTCDate() + (week - 1) * 7);
  return result;
}

/**
 * Return the ISO week label (YYYY-WNN) for today.
 *
 * @param timezone  Optional IANA timezone name (e.g. "America/Los_Angeles").
 *                  When provided, "today" is resolved in that timezone so the
 *                  week label matches the user's local calendar date.
 *                  Defaults to UTC to preserve backward-compatible behaviour
 *                  for callers that do not supply a timezone.
 */
export function currentWeekLabel(timezone?: string): string {
  let todayStr: string;
  if (timezone) {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    todayStr = formatter.format(new Date());
  } else {
    const now = new Date();
    todayStr = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
  }
  const d = new Date(todayStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
  const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const weekNum =
    1 +
    Math.round(
      ((d.getTime() - jan4.getTime()) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7,
    );
  return `${d.getUTCFullYear()}-W${weekNum.toString().padStart(2, '0')}`;
}

function isoDate(date: Date): string {
  return date.toISOString().substring(0, 10);
}

export class WeeklyPlanningService {
  private readonly shadowEventsRepo = new CalendarShadowEventsRepository();
  private readonly tasksRepo = new TasksRepository();
  private readonly projectInstancesRepo = new ProjectInstancesRepository();

  async assemblePlan(weekLabel: string, userId: number): Promise<WeeklyPlan> {
    const weekStart = parseWeekLabel(weekLabel);
    const weekEnd = new Date(weekStart);
    weekEnd.setUTCDate(weekStart.getUTCDate() + 6);

    const startStr = isoDate(weekStart);
    const endStr = isoDate(weekEnd);

    // Build day buckets Mon–Sun
    const days: WeeklyPlanDay[] = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setUTCDate(weekStart.getUTCDate() + i);
      return { date: isoDate(d), tasks: [] };
    });
    const dayMap = new Map(days.map((d) => [d.date, d]));

    const weekTasks = await this.tasksRepo.findByWeekAsync(startStr, endStr, userId);

    for (const task of weekTasks) {
      const pd = priorityDate(task);
      if (!pd) continue;
      const dateKey = isoDate(pd);
      const day = dayMap.get(dateKey);
      if (!day) continue;
      day.tasks.push(task);
    }

    const dueProjectSteps = await this.projectInstancesRepo.findPlannerStepsDueInRangeAsync(
      startStr,
      endStr,
      userId,
    );

    for (const task of dueProjectSteps) {
      if (!task.dueDate) continue;
      const day = dayMap.get(task.dueDate);
      if (!day) continue;
      day.tasks.push(task);
    }

    const shadowEvents = await this.shadowEventsRepo.findByRangeAsync(
      `${startStr}T00:00:00.000Z`,
      `${endStr}T23:59:59.999Z`,
      userId,
    );

    for (const event of shadowEvents) {
      const dayKey = event.startAt.substring(0, 10);
      const day = dayMap.get(dayKey);
      if (!day) continue;

      const timeLabel = event.isAllDay
          ? 'All day'
          : new Date(event.startAt).toLocaleTimeString('en-US', {
              hour: 'numeric',
              minute: '2-digit',
            });
      const detailBits = [timeLabel];
      if (event.location != null && event.location.length > 0) {
        detailBits.push(event.location);
      }
      if (event.description != null && event.description.length > 0) {
        detailBits.push(event.description);
      }

      day.tasks.push({
        id: event.id,
        title: event.title,
        notes: detailBits.join(' • '),
        dueDate: dayKey,
        scheduledDate: dayKey,
        scheduledOrder: null,
        locked: true,
        status: 'open',
        sourceType: 'calendar_shadow_event',
        sourceId: event.externalId,
        sourceName: event.sourceName,
        startsAt: event.startAt,
        endsAt: event.endAt,
        isAllDay: event.isAllDay,
        ownerId: event.ownerId,
        collaborators: [],
        createdAt: event.createdAt,
        updatedAt: event.updatedAt,
        preferredAgent: null,
      });
    }

    const backlog = await this.tasksRepo.findBacklogAsync(startStr, userId);

    backlog.push(
      ...(await this.projectInstancesRepo.findPlannerOpenStepsWithoutDueDateAsync(userId)),
    );

    backlog.push(
      ...(await this.projectInstancesRepo.findPlannerOpenStepsBeforeDateAsync(startStr, userId)),
    );

    for (const day of days) {
      day.tasks.sort(compareTaskVisualOrder);
    }
    backlog.sort(compareTaskVisualOrder);

    return { weekLabel, weekStart: startStr, days, backlog };
  }
}

function compareTaskVisualOrder(a: Task, b: Task): number {
  const compare = taskVisualOrder(a) - taskVisualOrder(b);
  if (compare !== 0) return compare;
  return a.title.toLowerCase().localeCompare(b.title.toLowerCase());
}

function taskVisualOrder(task: Task): number {
  if (task.sourceType === 'calendar_shadow_event' && task.startsAt != null) {
    const date = new Date(task.startsAt);
    if (!Number.isNaN(date.getTime())) {
      return ((date.getUTCHours() * 60) + date.getUTCMinutes()) * 10000;
    }
  }
  return task.scheduledOrder ?? 10000000;
}
