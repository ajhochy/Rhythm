import type { AddressInfo } from 'node:net';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import { createApp } from '../app';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { SessionsRepository } from '../repositories/sessions_repository';
import { TasksRepository } from '../repositories/tasks_repository';
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

describe('Tasks permissions', () => {
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

  it('does not expose another user tasks or legacy unowned tasks', async () => {
    const owner = usersRepo.create({ name: 'Owner', email: 'owner@example.com' });
    const other = usersRepo.create({ name: 'Other', email: 'other@example.com' });
    const ownerHeaders = await authHeaderFor(owner.id);
    const otherHeaders = await authHeaderFor(other.id);

    const createResponse = await fetch(`${baseUrl}/tasks`, {
      method: 'POST',
      headers: {
        ...ownerHeaders,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title: 'Owner private task' }),
    });
    expect(createResponse.status).toBe(201);
    const ownerTask = await readJson(createResponse) as { id: string };

    tasksRepo.create({ title: 'Legacy unowned task' });

    const ownerListResponse = await fetch(`${baseUrl}/tasks`, {
      headers: ownerHeaders,
    });
    expect(ownerListResponse.status).toBe(200);
    const ownerTasks = await readJson(ownerListResponse) as Array<{ title: string }>;
    expect(ownerTasks.map((task) => task.title)).toEqual(['Owner private task']);

    const otherListResponse = await fetch(`${baseUrl}/tasks`, {
      headers: otherHeaders,
    });
    expect(otherListResponse.status).toBe(200);
    expect(await readJson(otherListResponse)).toEqual([]);

    const otherDetailResponse = await fetch(`${baseUrl}/tasks/${ownerTask.id}`, {
      headers: otherHeaders,
    });
    expect(otherDetailResponse.status).toBe(404);
  });

  it('prevents non-owners from adding themselves as task collaborators', async () => {
    const owner = usersRepo.create({ name: 'Owner', email: 'task-owner@example.com' });
    const other = usersRepo.create({ name: 'Other', email: 'task-other@example.com' });
    const ownerHeaders = await authHeaderFor(owner.id);
    const otherHeaders = await authHeaderFor(other.id);

    const createResponse = await fetch(`${baseUrl}/tasks`, {
      method: 'POST',
      headers: {
        ...ownerHeaders,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title: 'Collaborator guarded task' }),
    });
    const task = await readJson(createResponse) as { id: string };

    const selfAddResponse = await fetch(`${baseUrl}/tasks/${task.id}/collaborators`, {
      method: 'POST',
      headers: {
        ...otherHeaders,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userId: other.id }),
    });
    expect(selfAddResponse.status).toBe(404);

    const stillHiddenResponse = await fetch(`${baseUrl}/tasks`, {
      headers: otherHeaders,
    });
    expect(await readJson(stillHiddenResponse)).toEqual([]);

    const ownerAddResponse = await fetch(`${baseUrl}/tasks/${task.id}/collaborators`, {
      method: 'POST',
      headers: {
        ...ownerHeaders,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userId: other.id }),
    });
    expect(ownerAddResponse.status).toBe(201);

    const collaboratorListResponse = await fetch(`${baseUrl}/tasks`, {
      headers: otherHeaders,
    });
    const collaboratorTasks = await readJson(collaboratorListResponse) as Array<{ id: string }>;
    expect(collaboratorTasks.map((visibleTask) => visibleTask.id)).toEqual([task.id]);
  });

  it('includes collaborators inline in GET /tasks and GET /tasks/:id', async () => {
    const owner = usersRepo.create({ name: 'Owner', email: 'inline-owner@example.com' });
    const collab = usersRepo.create({ name: 'Collab', email: 'inline-collab@example.com' });
    const ownerHeaders = await authHeaderFor(owner.id);

    const createRes = await fetch(`${baseUrl}/tasks`, {
      method: 'POST',
      headers: { ...ownerHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Shared task' }),
    });
    const created = await readJson(createRes) as { id: string; collaborators: unknown[] };
    expect(created.collaborators).toEqual([]);

    await fetch(`${baseUrl}/tasks/${created.id}/collaborators`, {
      method: 'POST',
      headers: { ...ownerHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: collab.id }),
    });

    const listRes = await fetch(`${baseUrl}/tasks`, { headers: ownerHeaders });
    const tasks = await readJson(listRes) as Array<{ id: string; collaborators: Array<{ userId: number; name: string }> }>;
    const found = tasks.find((t) => t.id === created.id);
    expect(found?.collaborators).toEqual([expect.objectContaining({ userId: collab.id, name: 'Collab' })]);

    const detailRes = await fetch(`${baseUrl}/tasks/${created.id}`, { headers: ownerHeaders });
    const detail = await readJson(detailRes) as { collaborators: Array<{ userId: number; name: string }> };
    expect(detail.collaborators).toEqual([expect.objectContaining({ userId: collab.id, name: 'Collab' })]);
  });

  it('owner-visible tasks have collaborators; owner-only tasks return empty collaborators array', async () => {
    const owner = usersRepo.create({ name: 'Owner2', email: 'owner2@example.com' });
    const ownerHeaders = await authHeaderFor(owner.id);

    const createRes = await fetch(`${baseUrl}/tasks`, {
      method: 'POST',
      headers: { ...ownerHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'No collaborators task' }),
    });
    const created = await readJson(createRes) as { id: string };

    const listRes = await fetch(`${baseUrl}/tasks`, { headers: ownerHeaders });
    const tasks = await readJson(listRes) as Array<{ id: string; collaborators: unknown[] }>;
    const found = tasks.find((t) => t.id === created.id);
    expect(found?.collaborators).toEqual([]);
  });
});
