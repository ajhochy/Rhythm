import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import {
  WeeklyPlanningService,
  parseWeekLabel,
  currentWeekLabel,
} from '../services/weekly_planning_service';
import { TasksRepository } from '../repositories/tasks_repository';
import { CalendarShadowEventsRepository } from '../repositories/calendar_shadow_events_repository';
import { UsersRepository } from '../repositories/users_repository';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  runMigrations(db);
  return db;
}

// ---------------------------------------------------------------------------
// parseWeekLabel / currentWeekLabel — pure function tests
// ---------------------------------------------------------------------------

describe('parseWeekLabel', () => {
  it('parses a known ISO week correctly', () => {
    // 2026-W01 starts on Monday 2025-12-29
    const d = parseWeekLabel('2026-W01');
    expect(d.toISOString().substring(0, 10)).toBe('2025-12-29');
  });

  it('parses mid-year week', () => {
    // 2026-W13 starts on Monday 2026-03-23
    const d = parseWeekLabel('2026-W13');
    expect(d.toISOString().substring(0, 10)).toBe('2026-03-23');
  });

  it('throws on invalid format', () => {
    expect(() => parseWeekLabel('not-a-week')).toThrow();
    expect(() => parseWeekLabel('2026W13')).toThrow();
  });
});

describe('currentWeekLabel', () => {
  it('returns a string matching YYYY-WNN format', () => {
    const label = currentWeekLabel();
    expect(label).toMatch(/^\d{4}-W\d{2}$/);
  });
});

// ---------------------------------------------------------------------------
// WeeklyPlanningService.assemblePlan — integration tests with in-memory DB
// ---------------------------------------------------------------------------

describe('WeeklyPlanningService.assemblePlan', () => {
  let tasksRepo: TasksRepository;
  let shadowRepo: CalendarShadowEventsRepository;
  let service: WeeklyPlanningService;
  let usersRepo: UsersRepository;
  let ownerId: number;

  const WEEK = '2026-W13'; // Mon 2026-03-23 → Sun 2026-03-29

  beforeEach(() => {
    const db = makeDb();
    setDb(db);
    tasksRepo = new TasksRepository();
    shadowRepo = new CalendarShadowEventsRepository();
    service = new WeeklyPlanningService();
    usersRepo = new UsersRepository();
    ownerId = usersRepo.create({ name: 'Alice', email: 'alice@example.com' }).id;
  });

  it('returns the correct week label and 7 days', () => {
    const plan = service.assemblePlan(WEEK);
    expect(plan.weekLabel).toBe(WEEK);
    expect(plan.weekStart).toBe('2026-03-23');
    expect(plan.days).toHaveLength(7);
    expect(plan.days[0].date).toBe('2026-03-23');
    expect(plan.days[6].date).toBe('2026-03-29');
  });

  it('places a task with due_date into the correct day', () => {
    tasksRepo.create({ title: 'Mon task', dueDate: '2026-03-23' });
    const plan = service.assemblePlan(WEEK);
    const monday = plan.days.find((d) => d.date === '2026-03-23')!;
    expect(monday.tasks).toHaveLength(1);
    expect(monday.tasks[0].title).toBe('Mon task');
  });

  it('places a task with scheduled_date (overriding due_date) into the correct day', () => {
    tasksRepo.create({ title: 'Scheduled task', dueDate: '2026-03-24', scheduledDate: '2026-03-25' });
    const plan = service.assemblePlan(WEEK);
    const tue = plan.days.find((d) => d.date === '2026-03-24')!;
    const wed = plan.days.find((d) => d.date === '2026-03-25')!;
    expect(tue.tasks).toHaveLength(0);
    expect(wed.tasks).toHaveLength(1);
    expect(wed.tasks[0].title).toBe('Scheduled task');
  });

  it('excludes tasks outside the week window', () => {
    tasksRepo.create({ title: 'Next week task', dueDate: '2026-03-30' });
    tasksRepo.create({ title: 'Last week task', dueDate: '2026-03-22' });
    const plan = service.assemblePlan(WEEK);
    const allDayTasks = plan.days.flatMap((d) => d.tasks);
    expect(allDayTasks).toHaveLength(0);
  });

  it('puts tasks with no date into the backlog', () => {
    tasksRepo.create({ title: 'Backlog task' });
    const plan = service.assemblePlan(WEEK);
    expect(plan.backlog.some((t) => t.title === 'Backlog task')).toBe(true);
    const allDayTasks = plan.days.flatMap((d) => d.tasks);
    expect(allDayTasks).toHaveLength(0);
  });

  it('excludes done tasks from backlog', () => {
    const task = tasksRepo.create({ title: 'Done backlog task' });
    tasksRepo.update(task.id, { status: 'done' });
    const plan = service.assemblePlan(WEEK);
    expect(plan.backlog.some((t) => t.title === 'Done backlog task')).toBe(false);
  });

  it('places calendar shadow events into the correct day', () => {
    shadowRepo.replaceForOwner(ownerId, [
      {
        provider: 'google_calendar',
        externalId: 'evt-001',
        calendarId: 'primary',
        sourceName: 'Personal',
        title: 'Team standup',
        description: null,
        location: null,
        startAt: '2026-03-24T14:00:00.000Z',
        endAt: '2026-03-24T14:30:00.000Z',
        isAllDay: false,
      },
    ]);
    const plan = service.assemblePlan(WEEK, ownerId);
    const tue = plan.days.find((d) => d.date === '2026-03-24')!;
    expect(tue.tasks).toHaveLength(1);
    expect(tue.tasks[0].title).toBe('Team standup');
    expect(tue.tasks[0].sourceType).toBe('calendar_shadow_event');
    expect(tue.tasks[0].locked).toBe(true);
  });

  it('handles multiple tasks across different days', () => {
    tasksRepo.create({ title: 'Mon', dueDate: '2026-03-23' });
    tasksRepo.create({ title: 'Wed', dueDate: '2026-03-25' });
    tasksRepo.create({ title: 'Fri', dueDate: '2026-03-27' });
    const plan = service.assemblePlan(WEEK);
    expect(plan.days.find((d) => d.date === '2026-03-23')!.tasks).toHaveLength(1);
    expect(plan.days.find((d) => d.date === '2026-03-25')!.tasks).toHaveLength(1);
    expect(plan.days.find((d) => d.date === '2026-03-27')!.tasks).toHaveLength(1);
    expect(plan.days.find((d) => d.date === '2026-03-24')!.tasks).toHaveLength(0);
  });

  it('returns empty days and empty backlog for an empty DB', () => {
    const plan = service.assemblePlan(WEEK);
    expect(plan.days.every((d) => d.tasks.length === 0)).toBe(true);
    expect(plan.backlog).toHaveLength(0);
  });
});
