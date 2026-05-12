import type { AddressInfo } from 'node:net';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import { createApp } from '../app';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { SessionsRepository } from '../repositories/sessions_repository';
import { TasksRepository } from '../repositories/tasks_repository';
import { UsersRepository } from '../repositories/users_repository';
import { parseTaskFilters } from '../controllers/tasks_controller';

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

// ─── Unit tests for parseTaskFilters ────────────────────────────────────────

describe('parseTaskFilters', () => {
  const userId = 1;

  it('returns default filter when no query params are provided', () => {
    const result = parseTaskFilters({}, userId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filter.status).toBe('open');
    expect(result.filter.scheduledBefore).toBeUndefined();
    expect(result.filter.dueBefore).toBeUndefined();
    expect(result.filter.overdue).toBeUndefined();
    expect(result.filter.search).toBeUndefined();
  });

  it('accepts a valid status value', () => {
    const result = parseTaskFilters({ status: 'done' }, userId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filter.status).toBe('done');
  });

  it('accepts status=all', () => {
    const result = parseTaskFilters({ status: 'all' }, userId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filter.status).toBe('all');
  });

  it('rejects an unknown status value', () => {
    const result = parseTaskFilters({ status: 'pending' }, userId);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.field).toBe('status');
  });

  it('accepts a valid scheduled_before date', () => {
    const result = parseTaskFilters({ scheduled_before: '2025-06-01' }, userId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filter.scheduledBefore).toBe('2025-06-01');
  });

  it('rejects a malformed scheduled_before date (wrong format)', () => {
    const result = parseTaskFilters({ scheduled_before: '06/01/2025' }, userId);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.field).toBe('scheduled_before');
  });

  it('rejects an invalid scheduled_before date (invalid calendar date)', () => {
    const result = parseTaskFilters({ scheduled_before: '2025-13-01' }, userId);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.field).toBe('scheduled_before');
  });

  it('accepts a valid due_before date', () => {
    const result = parseTaskFilters({ due_before: '2025-12-31' }, userId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filter.dueBefore).toBe('2025-12-31');
  });

  it('rejects a malformed due_before date', () => {
    const result = parseTaskFilters({ due_before: 'not-a-date' }, userId);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.field).toBe('due_before');
  });

  it("accepts overdue='true'", () => {
    const result = parseTaskFilters({ overdue: 'true' }, userId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filter.overdue).toBe(true);
  });

  it("accepts overdue='false'", () => {
    const result = parseTaskFilters({ overdue: 'false' }, userId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filter.overdue).toBe(false);
  });

  it('rejects an invalid overdue value', () => {
    const result = parseTaskFilters({ overdue: 'yes' }, userId);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.field).toBe('overdue');
  });

  it('accepts a search string', () => {
    const result = parseTaskFilters({ search: 'meeting' }, userId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filter.search).toBe('meeting');
  });

  it('returns a combined filter with multiple valid params', () => {
    const result = parseTaskFilters(
      { status: 'open', due_before: '2025-12-31', search: 'report' },
      userId,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filter.status).toBe('open');
    expect(result.filter.dueBefore).toBe('2025-12-31');
    expect(result.filter.search).toBe('report');
  });
});

// ─── Integration tests for GET /tasks query filters ─────────────────────────

describe('GET /tasks query param filters', () => {
  let usersRepo: UsersRepository;
  let sessionsRepo: SessionsRepository;
  let tasksRepo: TasksRepository;
  let baseUrl: string;
  let closeServer: () => Promise<void>;

  beforeEach(async () => {
    setDb(makeDb());
    usersRepo = new UsersRepository();
    sessionsRepo = new SessionsRepository();
    tasksRepo = new TasksRepository();

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

  async function createTask(
    userId: number,
    opts: { title: string; status?: string; dueDate?: string; scheduledDate?: string },
  ) {
    const headers = await authHeaderFor(userId);
    const resp = await fetch(`${baseUrl}/tasks`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: opts.title,
        status: opts.status,
        dueDate: opts.dueDate ?? null,
        scheduledDate: opts.scheduledDate ?? null,
      }),
    });
    expect(resp.status).toBe(201);
    const task = await readJson(resp) as { id: string; title: string };
    // If the task needs a scheduledDate set (POST may not handle it), patch it
    if (opts.scheduledDate) {
      const ph = await authHeaderFor(userId);
      await fetch(`${baseUrl}/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { ...ph, 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduledDate: opts.scheduledDate }),
      });
    }
    return task;
  }

  it('GET /tasks with no params returns only open tasks (default)', async () => {
    const user = usersRepo.create({ name: 'User', email: 'u1@example.com' });
    const headers = await authHeaderFor(user.id);

    // Create one open and one done task via the API
    await fetch(`${baseUrl}/tasks`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Open task' }),
    });

    const doneResp = await fetch(`${baseUrl}/tasks`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Done task', status: 'done' }),
    });
    const doneTask = await readJson(doneResp) as { id: string };

    // Also set an open task to done via PATCH
    const resp = await fetch(`${baseUrl}/tasks/${doneTask.id}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'done' }),
    });
    expect(resp.status).toBe(200);

    const listResp = await fetch(`${baseUrl}/tasks`, { headers });
    expect(listResp.status).toBe(200);
    const tasks = await readJson(listResp) as Array<{ title: string; status: string }>;
    // Default should only return open tasks
    expect(tasks.every((t) => t.status !== 'done')).toBe(true);
    expect(tasks.some((t) => t.title === 'Open task')).toBe(true);
  });

  it('GET /tasks?status=done returns only done tasks', async () => {
    const user = usersRepo.create({ name: 'User', email: 'u2@example.com' });
    const headers = await authHeaderFor(user.id);

    // Create one open task
    await fetch(`${baseUrl}/tasks`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Open task' }),
    });

    // Create one done task directly
    const doneResp = await fetch(`${baseUrl}/tasks`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Done task' }),
    });
    const doneTask = await readJson(doneResp) as { id: string };
    await fetch(`${baseUrl}/tasks/${doneTask.id}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'done' }),
    });

    const listResp = await fetch(`${baseUrl}/tasks?status=done`, { headers });
    expect(listResp.status).toBe(200);
    const tasks = await readJson(listResp) as Array<{ title: string; status: string }>;
    expect(tasks.every((t) => t.status === 'done')).toBe(true);
    expect(tasks.some((t) => t.title === 'Done task')).toBe(true);
  });

  it('GET /tasks?status=all returns both open and done tasks', async () => {
    const user = usersRepo.create({ name: 'User', email: 'u3@example.com' });
    const headers = await authHeaderFor(user.id);

    await fetch(`${baseUrl}/tasks`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Open task' }),
    });

    const doneResp = await fetch(`${baseUrl}/tasks`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Done task' }),
    });
    const doneTask = await readJson(doneResp) as { id: string };
    await fetch(`${baseUrl}/tasks/${doneTask.id}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'done' }),
    });

    const listResp = await fetch(`${baseUrl}/tasks?status=all`, { headers });
    expect(listResp.status).toBe(200);
    const tasks = await readJson(listResp) as Array<{ title: string }>;
    expect(tasks.length).toBeGreaterThanOrEqual(2);
    expect(tasks.some((t) => t.title === 'Open task')).toBe(true);
    expect(tasks.some((t) => t.title === 'Done task')).toBe(true);
  });

  it('GET /tasks?status=invalid returns 400 with validation error shape', async () => {
    const user = usersRepo.create({ name: 'User', email: 'u4@example.com' });
    const headers = await authHeaderFor(user.id);

    const resp = await fetch(`${baseUrl}/tasks?status=pending`, { headers });
    expect(resp.status).toBe(400);
    const body = await readJson(resp) as { error: string; field: string; message: string };
    expect(body.error).toBe('validation');
    expect(body.field).toBe('status');
    expect(typeof body.message).toBe('string');
  });

  it('GET /tasks?due_before=bad-date returns 400 with validation error shape', async () => {
    const user = usersRepo.create({ name: 'User', email: 'u5@example.com' });
    const headers = await authHeaderFor(user.id);

    const resp = await fetch(`${baseUrl}/tasks?due_before=not-a-date`, { headers });
    expect(resp.status).toBe(400);
    const body = await readJson(resp) as { error: string; field: string; message: string };
    expect(body.error).toBe('validation');
    expect(body.field).toBe('due_before');
  });

  it('GET /tasks?scheduled_before=bad-date returns 400', async () => {
    const user = usersRepo.create({ name: 'User', email: 'u6@example.com' });
    const headers = await authHeaderFor(user.id);

    const resp = await fetch(`${baseUrl}/tasks?scheduled_before=2025/06/01`, { headers });
    expect(resp.status).toBe(400);
    const body = await readJson(resp) as { error: string; field: string };
    expect(body.error).toBe('validation');
    expect(body.field).toBe('scheduled_before');
  });

  it('GET /tasks?overdue=yes returns 400', async () => {
    const user = usersRepo.create({ name: 'User', email: 'u7@example.com' });
    const headers = await authHeaderFor(user.id);

    const resp = await fetch(`${baseUrl}/tasks?overdue=yes`, { headers });
    expect(resp.status).toBe(400);
    const body = await readJson(resp) as { error: string; field: string };
    expect(body.error).toBe('validation');
    expect(body.field).toBe('overdue');
  });

  it('GET /tasks?due_before filters by due date', async () => {
    const user = usersRepo.create({ name: 'User', email: 'u8@example.com' });
    const headers = await authHeaderFor(user.id);

    // Task with past due date
    await fetch(`${baseUrl}/tasks`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Past task', dueDate: '2020-01-01' }),
    });

    // Task with future due date
    await fetch(`${baseUrl}/tasks`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Future task', dueDate: '2099-12-31' }),
    });

    // Task with no due date
    await fetch(`${baseUrl}/tasks`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'No date task' }),
    });

    const listResp = await fetch(`${baseUrl}/tasks?due_before=2025-01-01&status=all`, { headers });
    expect(listResp.status).toBe(200);
    const tasks = await readJson(listResp) as Array<{ title: string }>;
    expect(tasks.some((t) => t.title === 'Past task')).toBe(true);
    expect(tasks.every((t) => t.title !== 'Future task')).toBe(true);
    expect(tasks.every((t) => t.title !== 'No date task')).toBe(true);
  });

  it('GET /tasks?search= filters by title substring (case-insensitive)', async () => {
    const user = usersRepo.create({ name: 'User', email: 'u9@example.com' });
    const headers = await authHeaderFor(user.id);

    await fetch(`${baseUrl}/tasks`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Weekly Meeting' }),
    });

    await fetch(`${baseUrl}/tasks`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Send Report' }),
    });

    const listResp = await fetch(`${baseUrl}/tasks?search=meeting`, { headers });
    expect(listResp.status).toBe(200);
    const tasks = await readJson(listResp) as Array<{ title: string }>;
    expect(tasks.some((t) => t.title === 'Weekly Meeting')).toBe(true);
    expect(tasks.every((t) => t.title !== 'Send Report')).toBe(true);
  });

  it('GET /tasks?overdue=true returns only overdue open tasks', async () => {
    const user = usersRepo.create({ name: 'User', email: 'u10@example.com' });
    const headers = await authHeaderFor(user.id);

    // Overdue open task (past due date)
    await fetch(`${baseUrl}/tasks`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Overdue task', dueDate: '2020-01-01' }),
    });

    // Not overdue open task (future due date)
    await fetch(`${baseUrl}/tasks`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Future task', dueDate: '2099-12-31' }),
    });

    const listResp = await fetch(`${baseUrl}/tasks?overdue=true&status=all`, { headers });
    expect(listResp.status).toBe(200);
    const tasks = await readJson(listResp) as Array<{ title: string; status: string }>;
    expect(tasks.some((t) => t.title === 'Overdue task')).toBe(true);
    expect(tasks.every((t) => t.title !== 'Future task')).toBe(true);
    // All returned tasks must not be done
    expect(tasks.every((t) => t.status !== 'done')).toBe(true);
  });

  it('GET /tasks?overdue=false excludes overdue tasks', async () => {
    const user = usersRepo.create({ name: 'User', email: 'u11@example.com' });
    const headers = await authHeaderFor(user.id);

    await fetch(`${baseUrl}/tasks`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Overdue task', dueDate: '2020-01-01' }),
    });

    await fetch(`${baseUrl}/tasks`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Future task', dueDate: '2099-12-31' }),
    });

    const listResp = await fetch(`${baseUrl}/tasks?overdue=false&status=all`, { headers });
    expect(listResp.status).toBe(200);
    const tasks = await readJson(listResp) as Array<{ title: string }>;
    expect(tasks.every((t) => t.title !== 'Overdue task')).toBe(true);
  });

  it('GET /tasks handles combined filters: search + due_before', async () => {
    const user = usersRepo.create({ name: 'User', email: 'u12@example.com' });
    const headers = await authHeaderFor(user.id);

    // Matches both search and due_before
    await fetch(`${baseUrl}/tasks`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Report 2020', dueDate: '2020-03-01' }),
    });

    // Matches search but not due_before (future date)
    await fetch(`${baseUrl}/tasks`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Report 2099', dueDate: '2099-01-01' }),
    });

    // Matches due_before but not search
    await fetch(`${baseUrl}/tasks`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Other old task', dueDate: '2020-01-01' }),
    });

    const listResp = await fetch(
      `${baseUrl}/tasks?search=report&due_before=2025-01-01&status=all`,
      { headers },
    );
    expect(listResp.status).toBe(200);
    const tasks = await readJson(listResp) as Array<{ title: string }>;
    expect(tasks.some((t) => t.title === 'Report 2020')).toBe(true);
    expect(tasks.every((t) => t.title !== 'Report 2099')).toBe(true);
    expect(tasks.every((t) => t.title !== 'Other old task')).toBe(true);
  });
});
