import type { AddressInfo } from 'node:net';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import { createApp } from '../app';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { SessionsRepository } from '../repositories/sessions_repository';
import { TasksRepository } from '../repositories/tasks_repository';
import { RecurringTaskRulesRepository } from '../repositories/recurring_task_rules_repository';
import { UsersRepository } from '../repositories/users_repository';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  runMigrations(db);
  return db;
}

/**
 * Returns a YYYY-MM-DD date string for the given timezone, offset by `offsetDays`
 * from today (negative = past, positive = future).  All dashboard test fixtures
 * should use this helper so that "yesterday" in the test matches "yesterday" as
 * seen by the service, which classifies tasks using the user's timezone.
 */
function dateInTimezone(timezone: string, offsetDays: number): string {
  const todayStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  // Parse as local midnight so we can add/subtract days safely.
  const d = new Date(todayStr + 'T00:00:00');
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

async function readJson(response: Response) {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

describe('GET /dashboard/summary', () => {
  let usersRepo: UsersRepository;
  let sessionsRepo: SessionsRepository;
  let tasksRepo: TasksRepository;
  let rulesRepo: RecurringTaskRulesRepository;
  let baseUrl: string;
  let closeServer: () => Promise<void>;

  beforeEach(async () => {
    setDb(makeDb());
    usersRepo = new UsersRepository();
    sessionsRepo = new SessionsRepository();
    tasksRepo = new TasksRepository();
    rulesRepo = new RecurringTaskRulesRepository();

    const server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
    closeServer = () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
  });

  afterEach(async () => {
    await closeServer();
  });

  async function authHeaderFor(userId: number) {
    const session = await sessionsRepo.createAsync(userId);
    return { Authorization: `Bearer ${session.token}` };
  }

  it('returns a well-shaped summary with correct counts for a realistic scenario', async () => {
    const owner = usersRepo.create({ name: 'Alice', email: 'alice@example.com' });
    const headers = await authHeaderFor(owner.id);
    // Use the user's default timezone (America/Los_Angeles) so that "yesterday",
    // "today", and "tomorrow" align with the service's classification logic.
    const tz = 'America/Los_Angeles';
    const today = dateInTimezone(tz, 0);
    const yesterday = dateInTimezone(tz, -1);
    const tomorrow = dateInTimezone(tz, 1);

    // Create tasks: 1 past due, 1 today, 1 tomorrow, 1 done today, 1 unscheduled
    tasksRepo.create({ title: 'Past due task', dueDate: yesterday, ownerId: owner.id });
    tasksRepo.create({ title: 'Due today', dueDate: today, ownerId: owner.id });
    tasksRepo.create({ title: 'Due tomorrow', dueDate: tomorrow, ownerId: owner.id });
    const doneTask = tasksRepo.create({ title: 'Done today', dueDate: today, ownerId: owner.id });
    tasksRepo.update(doneTask.id, { status: 'done' }, owner.id);
    tasksRepo.create({ title: 'Unscheduled', ownerId: owner.id });

    // Create an enabled rhythm rule
    rulesRepo.create({
      title: 'Weekly prep',
      frequency: 'weekly',
      dayOfWeek: 0,
      ownerId: owner.id,
    });

    const res = await fetch(`${baseUrl}/dashboard/summary`, { headers });
    expect(res.status).toBe(200);

    const summary = await readJson(res) as {
      tasks: {
        openCount: number;
        pastDueCount: number;
        todayRemainingCount: number;
        todayTotalCount: number;
        thisWeekRemainingCount: number;
        unscheduledCount: number;
        recent: unknown[];
        today: unknown[];
        pastDue: unknown[];
        unscheduled: unknown[];
      };
      rhythms: { activeCount: number; items: Array<{ title: string; subtitle: string }> };
      projects: { activeCount: number; items: unknown[] };
      messages: { threadCount: number; unreadPreviews: unknown[] };
    };

    expect(summary.tasks.openCount).toBe(4); // 5 created - 1 done
    expect(summary.tasks.pastDueCount).toBe(1);
    expect(summary.tasks.todayRemainingCount).toBe(1);
    expect(summary.tasks.todayTotalCount).toBe(2); // today open + done today
    expect(summary.tasks.unscheduledCount).toBe(1);
    expect(summary.tasks.today).toHaveLength(1);
    expect(summary.tasks.pastDue).toHaveLength(1);
    expect(summary.tasks.unscheduled).toHaveLength(1);
    expect(summary.tasks.recent.length).toBeGreaterThan(0);

    // Inline collaborators array should be present on tasks
    const todayTask = summary.tasks.today[0] as Record<string, unknown>;
    expect(Array.isArray(todayTask['collaborators'])).toBe(true);

    expect(summary.rhythms.activeCount).toBe(1);
    expect(summary.rhythms.items[0].title).toBe('Weekly prep');
    expect(summary.rhythms.items[0].subtitle).toBe('Every Sunday');

    expect(summary.projects.activeCount).toBe(0);
    expect(summary.messages.threadCount).toBe(0);
  });

  it('only returns tasks visible to the requesting user', async () => {
    const owner = usersRepo.create({ name: 'Owner', email: 'owner@example.com' });
    const other = usersRepo.create({ name: 'Other', email: 'other@example.com' });
    const ownerHeaders = await authHeaderFor(owner.id);
    const otherHeaders = await authHeaderFor(other.id);

    tasksRepo.create({ title: 'Owner task', ownerId: owner.id });
    tasksRepo.create({ title: 'Other task', ownerId: other.id });

    const ownerSummary = await readJson(
      await fetch(`${baseUrl}/dashboard/summary`, { headers: ownerHeaders }),
    ) as { tasks: { openCount: number } };
    expect(ownerSummary.tasks.openCount).toBe(1);

    const otherSummary = await readJson(
      await fetch(`${baseUrl}/dashboard/summary`, { headers: otherHeaders }),
    ) as { tasks: { openCount: number } };
    expect(otherSummary.tasks.openCount).toBe(1);
  });

  it('requires authentication', async () => {
    const res = await fetch(`${baseUrl}/dashboard/summary`);
    expect(res.status).toBe(401);
  });

  it("respects the user's timezone when classifying tasks as past-due vs today", async () => {
    // This test pins dates relative to "today" using the server's clock (same as
    // the test runner).  The key assertion is that the dashboard uses the user's
    // timezone (America/Los_Angeles by default) rather than UTC, so a task
    // scheduled for today should show up in todayRemainingCount rather than
    // pastDueCount regardless of which UTC offset the test runner runs on.
    const owner = usersRepo.create({
      name: 'TZ user',
      email: 'tz@example.com',
      timezone: 'America/Los_Angeles',
    });
    const headers = await authHeaderFor(owner.id);

    // Derive "today" in America/Los_Angeles (same logic as the service under test).
    const laTodayStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Los_Angeles',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());

    tasksRepo.create({ title: 'LA today task', dueDate: laTodayStr, ownerId: owner.id });

    const res = await fetch(`${baseUrl}/dashboard/summary`, { headers });
    expect(res.status).toBe(200);

    const summary = await readJson(res) as {
      tasks: { pastDueCount: number; todayRemainingCount: number };
    };

    // The task is due today in LA → should appear in today, not past due.
    expect(summary.tasks.todayRemainingCount).toBe(1);
    expect(summary.tasks.pastDueCount).toBe(0);
  });

  it('pastDeadlineCount is present in response and defaults to 0 when no tasks are past deadline', async () => {
    const owner = usersRepo.create({ name: 'Bob', email: 'bob@example.com' });
    const headers = await authHeaderFor(owner.id);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

    tasksRepo.create({ title: 'Future task', dueDate: tomorrow, ownerId: owner.id });

    const res = await fetch(`${baseUrl}/dashboard/summary`, { headers });
    expect(res.status).toBe(200);

    const summary = await readJson(res) as { tasks: { pastDeadlineCount: number; pastDeadlineTasks: unknown[] } };
    expect(summary.tasks.pastDeadlineCount).toBe(0);
    expect(summary.tasks.pastDeadlineTasks).toHaveLength(0);
  });

  it('pastDeadlineCount counts task with dueDate in past but scheduledDate in future (past-deadline-only)', async () => {
    // A task where dueDate has passed but scheduledDate is future:
    //   isOverdue = false (priorityDate = scheduledDate which is future)
    //   isPastDeadline = true (dueDate < today)
    // → counted in pastDeadlineCount only, NOT in pastDueCount.
    const owner = usersRepo.create({ name: 'Carol', email: 'carol@example.com' });
    const headers = await authHeaderFor(owner.id);
    // Use the user's default timezone so dates match the service's classification.
    const tz = 'America/Los_Angeles';
    const yesterday = dateInTimezone(tz, -1);
    const tomorrow = dateInTimezone(tz, 1);

    // scheduledDate in future (not overdue), dueDate yesterday (past deadline)
    tasksRepo.create({
      title: 'Past deadline only',
      dueDate: yesterday,
      scheduledDate: tomorrow,
      ownerId: owner.id,
    });

    const res = await fetch(`${baseUrl}/dashboard/summary`, { headers });
    expect(res.status).toBe(200);

    const summary = await readJson(res) as {
      tasks: {
        pastDueCount: number;
        pastDeadlineCount: number;
        pastDeadlineTasks: Array<{ id: string; title: string; dueDate: string | null; scheduledDate: string | null; sourceType: string | null }>;
      };
    };

    // Must be mutually exclusive: past-deadline-only task goes to pastDeadlineCount
    expect(summary.tasks.pastDueCount).toBe(0);
    expect(summary.tasks.pastDeadlineCount).toBe(1);

    // pastDeadlineTasks should contain the task with correct fields
    expect(summary.tasks.pastDeadlineTasks).toHaveLength(1);
    expect(summary.tasks.pastDeadlineTasks[0].title).toBe('Past deadline only');
    expect(summary.tasks.pastDeadlineTasks[0].dueDate).toBe(yesterday);
    expect(summary.tasks.pastDeadlineTasks[0].scheduledDate).toBe(tomorrow);
    expect(summary.tasks.pastDeadlineTasks[0].sourceType).toBeNull();
  });

  it('pastDeadlineTasks is sorted by dueDate ascending (most-overdue deadline first)', async () => {
    const owner = usersRepo.create({ name: 'Frank', email: 'frank@example.com' });
    const headers = await authHeaderFor(owner.id);
    // Use the user's default timezone so dates match the service's classification.
    const tz = 'America/Los_Angeles';
    const twoDaysAgo = dateInTimezone(tz, -2);
    const yesterday = dateInTimezone(tz, -1);
    const tomorrow = dateInTimezone(tz, 1);
    const dayAfterTomorrow = dateInTimezone(tz, 2);

    // Two past-deadline-only tasks (dueDate past, scheduledDate future → not overdue)
    tasksRepo.create({
      title: 'Older deadline',
      dueDate: twoDaysAgo,
      scheduledDate: tomorrow,
      ownerId: owner.id,
    });
    tasksRepo.create({
      title: 'Newer deadline',
      dueDate: yesterday,
      scheduledDate: dayAfterTomorrow,
      ownerId: owner.id,
    });

    const res = await fetch(`${baseUrl}/dashboard/summary`, { headers });
    expect(res.status).toBe(200);

    const summary = await readJson(res) as {
      tasks: {
        pastDeadlineCount: number;
        pastDeadlineTasks: Array<{ title: string; dueDate: string | null }>;
      };
    };

    expect(summary.tasks.pastDeadlineCount).toBe(2);
    expect(summary.tasks.pastDeadlineTasks).toHaveLength(2);
    // Most-overdue deadline (oldest dueDate) first
    expect(summary.tasks.pastDeadlineTasks[0].title).toBe('Older deadline');
    expect(summary.tasks.pastDeadlineTasks[0].dueDate).toBe(twoDaysAgo);
    expect(summary.tasks.pastDeadlineTasks[1].title).toBe('Newer deadline');
    expect(summary.tasks.pastDeadlineTasks[1].dueDate).toBe(yesterday);
  });

  it('pastDeadlineCount excludes tasks that are overdue (mutual exclusivity)', async () => {
    // A task where both scheduledDate and dueDate are in the past:
    //   isOverdue = true  → counted in pastDueCount
    //   isPastDeadline = true, but overdue wins → NOT in pastDeadlineCount
    const owner = usersRepo.create({ name: 'Dave', email: 'dave@example.com' });
    const headers = await authHeaderFor(owner.id);
    const tz = 'America/Los_Angeles';
    const twoDaysAgo = dateInTimezone(tz, -2);
    const yesterday = dateInTimezone(tz, -1);

    // Both dates in the past → overdue AND past-deadline, but must count in pastDueCount only
    tasksRepo.create({
      title: 'Both overdue and past deadline',
      scheduledDate: twoDaysAgo,
      dueDate: yesterday,
      ownerId: owner.id,
    });

    const res = await fetch(`${baseUrl}/dashboard/summary`, { headers });
    expect(res.status).toBe(200);

    const summary = await readJson(res) as {
      tasks: { pastDueCount: number; pastDeadlineCount: number; pastDeadlineTasks: unknown[] };
    };

    // pastDueCount gets it; pastDeadlineCount must NOT double-count it
    expect(summary.tasks.pastDueCount).toBe(1);
    expect(summary.tasks.pastDeadlineCount).toBe(0);
    // pastDeadlineTasks must also be empty (task is in pastDue, not here)
    expect(summary.tasks.pastDeadlineTasks).toHaveLength(0);
  });

  it('done tasks are excluded from pastDeadlineCount', async () => {
    const owner = usersRepo.create({ name: 'Eve', email: 'eve@example.com' });
    const headers = await authHeaderFor(owner.id);
    const tz = 'America/Los_Angeles';
    const yesterday = dateInTimezone(tz, -1);
    const tomorrow = dateInTimezone(tz, 1);

    // Past-deadline-only task that's done → must not appear in pastDeadlineCount
    const doneTask = tasksRepo.create({
      title: 'Done past deadline task',
      dueDate: yesterday,
      scheduledDate: tomorrow,
      ownerId: owner.id,
    });
    tasksRepo.update(doneTask.id, { status: 'done' }, owner.id);

    const res = await fetch(`${baseUrl}/dashboard/summary`, { headers });
    expect(res.status).toBe(200);

    const summary = await readJson(res) as {
      tasks: { pastDeadlineCount: number; pastDeadlineTasks: unknown[] };
    };
    expect(summary.tasks.pastDeadlineCount).toBe(0);
    expect(summary.tasks.pastDeadlineTasks).toHaveLength(0);
  });
});
