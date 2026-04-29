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
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

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
});
