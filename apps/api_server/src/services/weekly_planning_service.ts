import { getDb } from '../database/db';
import { CalendarShadowEventsRepository } from '../repositories/calendar_shadow_events_repository';
import type { Task } from '../models/task';

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

interface ProjectStepRow {
  id: string;
  title: string;
  due_date: string | null;
  status: string;
  notes: string | null;
  instance_id: string;
  template_id: string;
  instance_name: string | null;
}

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
  source_name?: string | null;
  owner_id: number | null;
  created_at: string;
  updated_at: string;
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

/** Return the ISO week label (YYYY-WNN) for today. */
export function currentWeekLabel(): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
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

  assemblePlan(weekLabel: string, userId?: number): WeeklyPlan {
    const weekStart = parseWeekLabel(weekLabel);
    const weekEnd = new Date(weekStart);
    weekEnd.setUTCDate(weekStart.getUTCDate() + 6);

    const startStr = isoDate(weekStart);
    const endStr = isoDate(weekEnd);
    const db = getDb();

    // Build day buckets Mon–Sun
    const days: WeeklyPlanDay[] = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setUTCDate(weekStart.getUTCDate() + i);
      return { date: isoDate(d), tasks: [] };
    });
    const dayMap = new Map(days.map((d) => [d.date, d]));

    // 1+2: tasks (one-off and recurring instances) with due_date or scheduled_date in week
    const taskSelect = `
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
       AND tasks.source_id = rr.id
    `;
    const taskRows =
      userId != null
        ? (db
            .prepare(
              `${taskSelect}
               WHERE (tasks.owner_id = ? OR tasks.owner_id IS NULL)
                 AND (tasks.due_date BETWEEN ? AND ? OR tasks.scheduled_date BETWEEN ? AND ?)
               ORDER BY tasks.due_date ASC, tasks.created_at ASC`,
            )
            .all(userId, startStr, endStr, startStr, endStr) as TaskRow[])
        : (db
            .prepare(
              `${taskSelect}
               WHERE (tasks.due_date BETWEEN ? AND ? OR tasks.scheduled_date BETWEEN ? AND ?)
               ORDER BY tasks.due_date ASC, tasks.created_at ASC`,
            )
            .all(startStr, endStr, startStr, endStr) as TaskRow[]);

    for (const row of taskRows) {
      const dateKey = row.scheduled_date ?? row.due_date;
      if (!dateKey) continue;
      const day = dayMap.get(dateKey);
      if (!day) continue;
      day.tasks.push({
        id: row.id,
        title: row.title,
        dueDate: row.due_date,
        scheduledDate: row.scheduled_date ?? null,
        notes: row.notes ?? null,
        locked: row.locked === 1,
        status: row.status as Task['status'],
        sourceType: row.source_type,
        sourceId: row.source_id,
        sourceName: row.source_name ?? null,
        ownerId: row.owner_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      });
    }

    // 3: project instance steps due in the week
    const stepRows = db
      .prepare(
        `SELECT pis.id, pis.title, pis.due_date, pis.status, pis.notes, pis.instance_id,
                pi.template_id, pi.name as instance_name
         FROM project_instance_steps pis
         JOIN project_instances pi ON pi.id = pis.instance_id
         WHERE pis.due_date BETWEEN ? AND ? AND pis.due_date IS NOT NULL AND pis.due_date != ''
         ORDER BY pis.due_date ASC`,
      )
      .all(startStr, endStr) as ProjectStepRow[];

    for (const row of stepRows) {
      if (!row.due_date) continue;
      const day = dayMap.get(row.due_date);
      if (!day) continue;
      day.tasks.push({
        id: row.id,
        title: row.title,
        notes: row.notes ?? null,
        dueDate: row.due_date,
        scheduledDate: null,
        locked: false,
        status: row.status as Task['status'],
        sourceType: 'project_step',
        sourceId: row.instance_id,
        sourceName: row.instance_name ?? null,
        ownerId: null,
        createdAt: '',
        updatedAt: '',
      });
    }

    // 4: calendar shadow events
    const shadowEvents = this.shadowEventsRepo.findByRange(
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
        locked: true,
        status: 'open',
        sourceType: 'calendar_shadow_event',
        sourceId: event.externalId,
        sourceName: event.sourceName,
        ownerId: event.ownerId,
        createdAt: event.createdAt,
        updatedAt: event.updatedAt,
      });
    }

    // 5: backlog — open tasks with no due/scheduled date, plus carryover from before this week
    const backlogRows =
      userId != null
        ? (db
            .prepare(
              `${taskSelect}
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
            .all(startStr, startStr, userId) as TaskRow[])
        : (db
            .prepare(
              `${taskSelect}
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
            .all(startStr, startStr) as TaskRow[]);
    const backlog: Task[] = backlogRows.map((row) => ({
      id: row.id,
      title: row.title,
      notes: row.notes ?? null,
      dueDate: row.due_date ?? null,
      scheduledDate: row.scheduled_date ?? null,
      locked: row.locked === 1,
      status: row.status as Task['status'],
      sourceType: row.source_type,
      sourceId: row.source_id,
      sourceName: row.source_name ?? null,
      ownerId: row.owner_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    const unscheduledProjectSteps = db
      .prepare(
        `SELECT pis.id, pis.title, pis.due_date, pis.status, pis.notes, pis.instance_id,
                pi.template_id, pi.name as instance_name
         FROM project_instance_steps pis
         JOIN project_instances pi ON pi.id = pis.instance_id
         WHERE pis.status = 'open' AND (pis.due_date IS NULL OR pis.due_date = '')
         ORDER BY pi.created_at ASC, pis.title ASC`,
      )
      .all() as ProjectStepRow[];

    backlog.push(
      ...unscheduledProjectSteps.map((row) => ({
        id: row.id,
        title: row.title,
        notes: row.notes ?? null,
        dueDate: null,
        scheduledDate: null,
        locked: false,
        status: row.status as Task['status'],
        sourceType: 'project_step',
        sourceId: row.instance_id,
        sourceName: row.instance_name ?? null,
        ownerId: null,
        createdAt: '',
        updatedAt: '',
      })),
    );

    const carryoverProjectSteps = db
      .prepare(
        `SELECT pis.id, pis.title, pis.due_date, pis.status, pis.notes, pis.instance_id,
                pi.template_id, pi.name as instance_name
         FROM project_instance_steps pis
         JOIN project_instances pi ON pi.id = pis.instance_id
         WHERE pis.status = 'open'
           AND pis.due_date IS NOT NULL
           AND pis.due_date != ''
           AND pis.due_date < ?
         ORDER BY pis.due_date ASC, pi.created_at ASC`,
      )
      .all(startStr) as ProjectStepRow[];

    backlog.push(
      ...carryoverProjectSteps.map((row) => ({
        id: row.id,
        title: row.title,
        notes: row.notes ?? null,
        dueDate: row.due_date ?? null,
        scheduledDate: null,
        locked: false,
        status: row.status as Task['status'],
        sourceType: 'project_step',
        sourceId: row.instance_id,
        sourceName: row.instance_name ?? null,
        ownerId: null,
        createdAt: '',
        updatedAt: '',
      })),
    );

    return { weekLabel, weekStart: startStr, days, backlog };
  }
}
