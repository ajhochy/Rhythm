/**
 * Unit / integration tests for TasksRepository.findByFilter (SQLite).
 *
 * Each test uses an in-memory SQLite database so tests are fully isolated and
 * do not touch the filesystem.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';

import { runMigrations } from '../database/migrations';
import { getDb, setDb } from '../database/db';
import * as database from '../database/db';
import { env } from '../config/env';
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
    notes?: string;
    status?: string;
    dueDate?: string;
    scheduledDate?: string;
  }) {
    return repo.createAsync({
      title: opts.title,
      notes: opts.notes,
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

  it('search retrieves title and notes candidates', async () => {
    await seed({ title: 'Weekly Meeting' });
    await seed({ title: 'Prepare agenda', notes: 'Notes for the weekly meeting' });
    await seed({ title: 'Send Report' });

    const tasks = repo.findByFilter(baseFilter({ search: 'meeting' }));
    const titles = tasks.map((t) => t.title);
    expect(titles).toContain('Weekly Meeting');
    expect(titles).toContain('Prepare agenda');
    expect(titles).not.toContain('Send Report');
  });

  it('ranks multi-token stronger matches above canonical date order', async () => {
    await seed({ title: 'Weekly planning review', dueDate: FUTURE });
    await seed({ title: 'Weekly planning review with unrelated context', dueDate: PAST });

    const tasks = repo.findByFilter(baseFilter({ search: 'weekly planning' }));
    expect(tasks.map((task) => task.title)).toEqual([
      'Weekly planning review',
      'Weekly planning review with unrelated context',
    ]);
  });

  it('uses canonical ordering and id as deterministic BM25 tie breakers', async () => {
    const laterId = (await seed({ title: 'Matching task' })).id;
    const earlierId = (await seed({ title: 'Matching task' })).id;
    getDb().prepare('UPDATE tasks SET created_at = ? WHERE id IN (?, ?)').run(
      '2026-01-01T00:00:00.000Z',
      laterId,
      earlierId,
    );

    const tasks = repo.findByFilter(baseFilter({ search: 'matching' }));
    expect(tasks.map((task) => task.id)).toEqual([laterId, earlierId].sort());
  });

  it('uses a bound Postgres search-vector candidate query', async () => {
    const originalDbClient = env.dbClient;
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const poolSpy = vi.spyOn(database, 'getPostgresPool').mockReturnValue({ query } as never);
    (env as { dbClient: 'sqlite' | 'postgres' }).dbClient = 'postgres';

    try {
      await expect(repo.findByFilterAsync(baseFilter({ search: 'weekly planning' }))).resolves.toEqual([]);
      const [sql, params] = query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain("tasks.search_vector @@ plainto_tsquery('english', $2)");
      expect(sql).not.toContain('weekly planning');
      expect(params).toContain('weekly planning');
    } finally {
      (env as { dbClient: 'sqlite' | 'postgres' }).dbClient = originalDbClient;
      poolSpy.mockRestore();
    }
  });

  it('does not treat raw FTS syntax as an operator', async () => {
    await seed({ title: 'Weekly meeting' });
    await seed({ title: 'Weekly report' });

    expect(repo.findByFilter(baseFilter({ search: 'weekly OR report' }))).toEqual([]);
  });

  it('falls back to title and notes LIKE search only when FTS5 is unavailable', async () => {
    await seed({ title: 'Prepare agenda', notes: 'Notes for the weekly meeting' });
    getDb().exec('DROP TABLE tasks_fts');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      expect(repo.findByFilter(baseFilter({ search: 'meeting' })).map((task) => task.title))
        .toEqual(['Prepare agenda']);
      expect(warn).toHaveBeenCalledWith('tasks FTS5 unavailable; using title+notes LIKE fallback');
    } finally {
      warn.mockRestore();
    }
  });

  it('empty search string returns all tasks for user', async () => {
    await seed({ title: 'Task A' });
    await seed({ title: 'Task B' });

    const tasks = repo.findByFilter(baseFilter({ search: '' }));
    expect(tasks.length).toBeGreaterThanOrEqual(2);
  });

  it('whitespace-only search preserves no-search canonical order', async () => {
    await seed({ title: 'Later', dueDate: FUTURE });
    await seed({ title: 'Earlier', dueDate: PAST });

    expect(repo.findByFilter(baseFilter({ search: '  ' })).map((task) => task.id))
      .toEqual(repo.findByFilter(baseFilter()).map((task) => task.id));
  });

  it('search candidates retain visibility before leaving the repository', async () => {
    const other = new UsersRepository().create({ name: 'Bob', email: 'bob@example.com' });
    const mine = await seed({ title: 'My weekly planning' });
    const shared = await repo.createAsync({ title: 'Shared weekly planning', ownerId: other.id });
    await repo.createAsync({ title: 'Hidden weekly planning', ownerId: other.id });
    repo.addCollaborator(shared.id, userId);

    expect(repo.findByFilter(baseFilter({ search: 'weekly planning' })).map((task) => task.id))
      .toEqual(expect.arrayContaining([mine.id, shared.id]));
    expect(repo.findByFilter(baseFilter({ search: 'weekly planning' })).map((task) => task.title))
      .not.toContain('Hidden weekly planning');
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

  it('overdue-first: open overdue tasks sort before non-overdue, then by priority date, then nulls last', async () => {
    // Overdue active tasks (priority date < TODAY and status is neither terminal state)
    await seed({ title: 'Overdue A', dueDate: '2020-01-01' });
    await seed({ title: 'Overdue B', scheduledDate: '2021-06-15' });
    // Non-overdue open tasks
    await seed({ title: 'Today task', dueDate: TODAY });
    await seed({ title: 'Future task', dueDate: FUTURE });
    // Overdue but DONE → not overdue per the CASE; should fall in non-overdue tier
    await seed({ title: 'Overdue done', dueDate: PAST, status: 'done' });
    // Deferred is also inactive and must not be promoted as overdue.
    await seed({ title: 'Overdue deferred', dueDate: PAST, status: 'deferred' });
    // No date at all → NULLS LAST within non-overdue tier
    await seed({ title: 'No date open' });

    const tasks = repo.findByFilter(baseFilter({ status: 'all', today: TODAY }));
    const titles = tasks.map((t) => t.title);

    const idxOverdueA = titles.indexOf('Overdue A');
    const idxOverdueB = titles.indexOf('Overdue B');
    const idxToday = titles.indexOf('Today task');
    const idxFuture = titles.indexOf('Future task');
    const idxOverdueDone = titles.indexOf('Overdue done');
    const idxOverdueDeferred = titles.indexOf('Overdue deferred');
    const idxNoDate = titles.indexOf('No date open');

    // Both overdue open tasks must come before any non-overdue tasks
    expect(idxOverdueA).toBeLessThan(idxToday);
    expect(idxOverdueA).toBeLessThan(idxFuture);
    expect(idxOverdueB).toBeLessThan(idxToday);
    expect(idxOverdueB).toBeLessThan(idxFuture);

    // Within the overdue tier, sorted by priority date ASC (2020 before 2021)
    expect(idxOverdueA).toBeLessThan(idxOverdueB);

    // Within the non-overdue tier: today < future < no-date (NULLS LAST)
    expect(idxToday).toBeLessThan(idxFuture);
    expect(idxFuture).toBeLessThan(idxNoDate);

    // Overdue done falls into the non-overdue tier (CASE excludes it)
    // so it must come after both overdue-open tasks
    expect(idxOverdueA).toBeLessThan(idxOverdueDone);
    expect(idxOverdueB).toBeLessThan(idxOverdueDone);
    expect(idxOverdueA).toBeLessThan(idxOverdueDeferred);
    expect(idxOverdueB).toBeLessThan(idxOverdueDeferred);
  });

  // ── empty results ─────────────────────────────────────────────────────────

  it('returns [] when no tasks match, never throws', () => {
    const tasks = repo.findByFilter(baseFilter({ search: 'nonexistent-xyz-987' }));
    expect(tasks).toEqual([]);
  });
});
