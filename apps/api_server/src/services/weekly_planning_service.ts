import { getDb } from '../database/db';
import type { Task } from '../models/task';

export interface WeeklyPlanDay {
  date: string;
  tasks: Task[];
}

export interface WeeklyPlan {
  weekLabel: string;
  weekStart: string;
  days: WeeklyPlanDay[];
}

interface ProjectStepRow {
  id: string;
  title: string;
  due_date: string;
  status: string;
  instance_id: string;
  template_id: string;
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
  assemblePlan(weekLabel: string): WeeklyPlan {
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
    type TaskRow = {
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
    };
    const taskRows = db
      .prepare(
        `SELECT * FROM tasks
         WHERE (due_date BETWEEN ? AND ? OR scheduled_date BETWEEN ? AND ?)
         ORDER BY due_date ASC, created_at ASC`,
      )
      .all(startStr, endStr, startStr, endStr) as TaskRow[];

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
        locked: row.locked === 1,
        status: row.status as Task['status'],
        sourceType: row.source_type,
        sourceId: row.source_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      });
    }

    // 3: project instance steps due in the week
    const stepRows = db
      .prepare(
        `SELECT pis.id, pis.title, pis.due_date, pis.status, pis.instance_id,
                pi.template_id
         FROM project_instance_steps pis
         JOIN project_instances pi ON pi.id = pis.instance_id
         WHERE pis.due_date BETWEEN ? AND ?
         ORDER BY pis.due_date ASC`,
      )
      .all(startStr, endStr) as ProjectStepRow[];

    for (const row of stepRows) {
      const day = dayMap.get(row.due_date);
      if (!day) continue;
      day.tasks.push({
        id: row.id,
        title: row.title,
        dueDate: row.due_date,
        scheduledDate: null,
        locked: false,
        status: row.status as Task['status'],
        sourceType: 'project_step',
        sourceId: row.template_id,
        createdAt: '',
        updatedAt: '',
      });
    }

    // 4: calendar shadow events — stubbed empty for Phase 4

    return { weekLabel, weekStart: startStr, days };
  }
}
