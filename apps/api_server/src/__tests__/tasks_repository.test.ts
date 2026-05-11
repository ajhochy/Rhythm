/**
 * Unit / integration tests for TasksRepository.findByFilter (SQLite).
 *
 * Each test uses an in-memory SQLite database so tests are fully isolated and
 * do not touch the filesystem.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { TasksRepository } from '../repositories/tasks_repository';
import { UsersRepository } from '../repositories/users_repository';
import type { TaskFilter } from '../models/task_filter';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  runMigrations(db);
  return db;
}

// A fixed "today" used across tests so results are deterministic.
const TODAY = '2026-05-11';
const PAST = '2020-01-01';
const FUTURE = '2099-12-31';

describe('TasksRepository.findByFilter', () => {
  let repo: TasksRepository;
  let userId: number;

  beforeEach(() => {
    setDb(makeDb());
    repo = new TasksRepository();
    const usersRepo = new UsersRepository();
    const user = usersRepo.create({ name: 'Alice', email: 'alice@example.com' });
    userId = user.id;
  });

  function baseFilter(overrides: Partial<TaskFilter> = {}): TaskFilter {
    return { userId, status: 'all', today: TODAY, ...overrides };
  }

  async function seed(opts: {
    title: string;
    status?: string;
    dueDate?: string;
    scheduledDate?: string;
  }) {
    return repo.createAsync({
      title: opts.title,
      status: (opts.status ?? 'open') as 'open' | 'done',
      dueDate: opts.dueDate ?? null,
      scheduledDate: opts.scheduledDate ?? null,
      ownerId: userId,
    });
  }

  // ── status filter ──────────────────────────────────────────────────────────

  it('status=open excludes done tasks', async () => {
    await seed({ title: 'Open task' });
    await seed({ title: 'Done task', status: 'done' });

    const tasks = repo.findByFilter(baseFilter({ status: 'open' }));
    expect(tasks.map((t) => t.title)).toContain('Open task');
    expect(tasks.map((t) => t.title)).not.toContain('Done task');
  });

  it('status=done returns only done tasks', async () => {
    await seed({ title: 'Open task' });
    await seed({ title: 'Done task', status: 'done' });

    const tasks = repo.findByFilter(baseFilter({ status: 'done' }));
    expect(tasks.map((t) => t.title)).not.toContain('Open task');
    expect(tasks.map((t) => t.title)).toContain('Done task');
  });

  it('status=all returns both open and done tasks', async () => {
    await seed({ title: 'Open task' });
    await seed({ title: 'Done task', status: 'done' });

    const tasks = repo.findByFilter(baseFilter({ status: 'all' }));
    const titles = tasks.map((t) => t.title);
    expect(titles).toContain('Open task');
    expect(titles).toContain('Done task');
  });

  // ── scheduledBefore filter ─────────────────────────────────────────────────

  it('scheduledBefore filters by COALESCE(scheduled_date, due_date)', async () => {
    // scheduled_date wins when present
    await seed({ title: 'Past scheduled', scheduledDate: PAST });
    // falls back to due_date when scheduled_date is null
    await seed({ title: 'Past due', dueDate: PAST });
    await seed({ title: 'Future scheduled', scheduledDate: FUTURE });
    await seed({ title: 'Future due', dueDate: FUTURE });
    // no date at all → excluded
    await seed({ title: 'No date' });

    const tasks = repo.findByFilter(baseFilter({ scheduledBefore: '2025-01-01' }));
    const titles = tasks.map((t) => t.title);
    expect(titles).toContain('Past scheduled');
    expect(titles).toContain('Past due');
    expect(titles).not.toContain('Future scheduled');
    expect(titles).not.toContain('Future due');
    expect(titles).not.toContain('No date');
  });

  it('scheduledBefore is inclusive (date == boundary is included)', async () => {
    await seed({ title: 'Boundary', dueDate: '2025-01-01' });
    const tasks = repo.findByFilter(baseFilter({ scheduledBefore: '2025-01-01' }));
    expect(tasks.map((t) => t.title)).toContain('Boundary');
  });

  // ── dueBefore filter ───────────────────────────────────────────────────────

  it('dueBefore requires due_date (tasks with only scheduled_date excluded)', async () => {
    await seed({ title: 'Past due', dueDate: PAST });
    await seed({ title: 'Past scheduled only', scheduledDate: PAST });
    await seed({ title: 'Future due', dueDate: FUTURE });
    await seed({ title: 'No date' });

    const tasks = repo.findByFilter(baseFilter({ dueBefore: '2025-01-01' }));
    const titles = tasks.map((t) => t.title);
    expect(titles).toContain('Past due');
    expect(titles).not.toContain('Past scheduled only');
    expect(titles).not.toContain('Future due');
    expect(titles).not.toContain('No date');
  });

  // ── overdue filter ─────────────────────────────────────────────────────────

  it('overdue=true returns open tasks with priority date < today', async () => {
    await seed({ title: 'Overdue open', dueDate: PAST });
    await seed({ title: 'Future open', dueDate: FUTURE });
    await seed({ title: 'Overdue done', dueDate: PAST, status: 'done' });
    await seed({ title: 'No date open' });

    const tasks = repo.findByFilter(baseFilter({ overdue: true, status: 'all' }));
    const titles = tasks.map((t) => t.title);
    expect(titles).toContain('Overdue open');
    expect(titles).not.toContain('Future open');
    expect(titles).not.toContain('Overdue done');
    expect(titles).not.toContain('No date open');
  });

  it('overdue=true uses scheduled_date when present over due_date', async () => {
    // scheduled_date is in the past → overdue even though due_date is in the future
    await seed({ title: 'Overdue by scheduled', scheduledDate: PAST, dueDate: FUTURE });
    const tasks = repo.findByFilter(baseFilter({ overdue: true, status: 'all' }));
    expect(tasks.map((t) => t.title)).toContain('Overdue by scheduled');
  });

  it('overdue=false excludes overdue tasks', async () => {
    await seed({ title: 'Overdue open', dueDate: PAST });
    await seed({ title: 'Future open', dueDate: FUTURE });
    await seed({ title: 'No date open' });

    const tasks = repo.findByFilter(baseFilter({ overdue: false, status: 'all' }));
    const titles = tasks.map((t) => t.title);
    expect(titles).not.toContain('Overdue open');
    // Non-overdue tasks are included
    expect(titles).toContain('Future open');
    expect(titles).toContain('No date open');
  });

  // ── search filter ──────────────────────────────────────────────────────────

  it('search matches case-insensitively on title substring', async () => {
    await seed({ title: 'Weekly Meeting' });
    await seed({ title: 'Send Report' });
    await seed({ title: 'MEETING notes' });

    const tasks = repo.findByFilter(baseFilter({ search: 'meeting' }));
    const titles = tasks.map((t) => t.title);
    expect(titles).toContain('Weekly Meeting');
    expect(titles).toContain('MEETING notes');
    expect(titles).not.toContain('Send Report');
  });

  it('empty search string returns all tasks for user', async () => {
    await seed({ title: 'Task A' });
    await seed({ title: 'Task B' });

    const tasks = repo.findByFilter(baseFilter({ search: '' }));
    expect(tasks.length).toBeGreaterThanOrEqual(2);
  });

  // ── combined filters ───────────────────────────────────────────────────────

  it('status=open + scheduledBefore ANDs the clauses', async () => {
    await seed({ title: 'Open past', dueDate: PAST });
    await seed({ title: 'Done past', dueDate: PAST, status: 'done' });
    await seed({ title: 'Open future', dueDate: FUTURE });

    const tasks = repo.findByFilter(
      baseFilter({ status: 'open', scheduledBefore: '2025-01-01' }),
    );
    const titles = tasks.map((t) => t.title);
    expect(titles).toContain('Open past');
    expect(titles).not.toContain('Done past');
    expect(titles).not.toContain('Open future');
  });

  it('search + due_before ANDs the clauses', async () => {
    // Matches both
    await seed({ title: 'Report 2020', dueDate: '2020-03-01' });
    // Matches search but not due_before
    await seed({ title: 'Report 2099', dueDate: FUTURE });
    // Matches due_before but not search
    await seed({ title: 'Other old task', dueDate: '2020-01-01' });

    const tasks = repo.findByFilter(
      baseFilter({ search: 'report', dueBefore: '2025-01-01', status: 'all' }),
    );
    const titles = tasks.map((t) => t.title);
    expect(titles).toContain('Report 2020');
    expect(titles).not.toContain('Report 2099');
    expect(titles).not.toContain('Other old task');
  });

  // ── isolation ─────────────────────────────────────────────────────────────

  it('does not return tasks owned by another user', async () => {
    const usersRepo = new UsersRepository();
    const other = usersRepo.create({ name: 'Bob', email: 'bob@example.com' });

    await repo.createAsync({ title: 'My task', ownerId: userId });
    await repo.createAsync({ title: 'Their task', ownerId: other.id });

    const tasks = repo.findByFilter(baseFilter());
    const titles = tasks.map((t) => t.title);
    expect(titles).toContain('My task');
    expect(titles).not.toContain('Their task');
  });

  // ── ordering ──────────────────────────────────────────────────────────────

  it('returns tasks ordered by COALESCE(scheduled_date, due_date) ASC NULLS LAST', async () => {
    await seed({ title: 'No date' });
    await seed({ title: 'Far future', dueDate: FUTURE });
    await seed({ title: 'Near past', dueDate: PAST });

    const tasks = repo.findByFilter(baseFilter());
    const titles = tasks.map((t) => t.title);
    const nearIdx = titles.indexOf('Near past');
    const farIdx = titles.indexOf('Far future');
    const noneIdx = titles.indexOf('No date');

    expect(nearIdx).toBeLessThan(farIdx);
    // NULLS LAST: 'No date' should come after both dated tasks
    expect(noneIdx).toBeGreaterThan(farIdx);
  });

  // ── empty results ─────────────────────────────────────────────────────────

  it('returns [] when no tasks match, never throws', () => {
    const tasks = repo.findByFilter(baseFilter({ search: 'nonexistent-xyz-987' }));
    expect(tasks).toEqual([]);
  });
});
