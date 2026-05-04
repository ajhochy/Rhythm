import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { createApp } from '../app';
import { runMigrations } from '../database/migrations';
import { setDb, getDb } from '../database/db';
import { SessionsRepository } from '../repositories/sessions_repository';
import { TasksRepository } from '../repositories/tasks_repository';
import { UsersRepository } from '../repositories/users_repository';
import { env } from '../config/env';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

describe('Claude triggers endpoints', () => {
  let usersRepo: UsersRepository;
  let sessionsRepo: SessionsRepository;
  let tasksRepo: TasksRepository;
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let claudeId: number;
  let originalClaudeUserId: number | null;

  beforeEach(async () => {
    setDb(makeDb());
    usersRepo = new UsersRepository();
    sessionsRepo = new SessionsRepository();
    tasksRepo = new TasksRepository();

    const claude = usersRepo.create({ name: 'Claude', email: 'claude@x.com' });
    claudeId = claude.id;
    originalClaudeUserId = env.claudeUserId;
    (env as any).claudeUserId = claudeId;

    const server = createApp().listen(0);
    await new Promise<void>((r) => server.once('listening', () => r()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    closeServer = () => new Promise<void>((res, rej) => server.close((e) => e ? rej(e) : res()));
  });

  afterEach(async () => {
    (env as any).claudeUserId = originalClaudeUserId;
    await closeServer();
  });

  async function authHeaderFor(userId: number) {
    const session = await sessionsRepo.createAsync(userId);
    return { Authorization: `Bearer ${session.token}` };
  }

  it('returns 403 for non-claude users', async () => {
    const u = usersRepo.create({ name: 'U', email: 'u@x.com' });
    const headers = await authHeaderFor(u.id);
    const res = await fetch(`${baseUrl}/claude-triggers`, { headers });
    expect(res.status).toBe(403);
  });

  it('returns the queue for claude user', async () => {
    const owner = usersRepo.create({ name: 'O', email: 'o@x.com' });
    const task = tasksRepo.create({ title: 'Test task', ownerId: owner.id });
    getDb().prepare(`INSERT INTO pending_claude_triggers (task_id, triggered_by_user_id) VALUES (?, ?)`)
      .run(task.id, owner.id);

    const headers = await authHeaderFor(claudeId);
    const res = await fetch(`${baseUrl}/claude-triggers`, { headers });
    expect(res.status).toBe(200);
    const triggers = await res.json() as Array<{ taskId: string; taskTitle: string }>;
    expect(triggers).toHaveLength(1);
    expect(triggers[0].taskId).toBe(task.id);
    expect(triggers[0].taskTitle).toBe('Test task');
  });

  it('deletes a trigger', async () => {
    const owner = usersRepo.create({ name: 'O', email: 'o2@x.com' });
    const task = tasksRepo.create({ title: 'T', ownerId: owner.id });
    getDb().prepare(`INSERT INTO pending_claude_triggers (task_id) VALUES (?)`)
      .run(task.id);
    const r = getDb().prepare(`SELECT id FROM pending_claude_triggers WHERE task_id = ?`)
      .get(task.id) as { id: number };

    const headers = await authHeaderFor(claudeId);
    const res = await fetch(`${baseUrl}/claude-triggers/${r.id}`, { method: 'DELETE', headers });
    expect(res.status).toBe(204);

    const remaining = getDb().prepare(`SELECT COUNT(*) AS c FROM pending_claude_triggers`).get() as { c: number };
    expect(remaining.c).toBe(0);
  });

  it('writes a pending trigger when Claude is added as a collaborator', async () => {
    const owner = usersRepo.create({ name: 'O', email: 'o3@x.com' });
    const task = tasksRepo.create({ title: 'Trigger me', ownerId: owner.id });

    const headers = await authHeaderFor(owner.id);
    const res = await fetch(`${baseUrl}/tasks/${task.id}/collaborators`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: claudeId }),
    });
    expect(res.status).toBe(201);

    const triggers = getDb().prepare(`SELECT * FROM pending_claude_triggers`).all() as any[];
    expect(triggers).toHaveLength(1);
    expect(triggers[0].task_id).toBe(task.id);
    expect(triggers[0].triggered_by_user_id).toBe(owner.id);
  });

  it('does NOT write a trigger when a non-Claude collaborator is added', async () => {
    const owner = usersRepo.create({ name: 'O', email: 'o4@x.com' });
    const other = usersRepo.create({ name: 'X', email: 'x@x.com' });
    const task = tasksRepo.create({ title: 'No trigger', ownerId: owner.id });

    const headers = await authHeaderFor(owner.id);
    await fetch(`${baseUrl}/tasks/${task.id}/collaborators`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: other.id }),
    });

    const triggers = getDb().prepare(`SELECT * FROM pending_claude_triggers`).all() as any[];
    expect(triggers).toHaveLength(0);
  });

  it('repeated add/remove/add of Claude produces only one trigger row', async () => {
    const owner = usersRepo.create({ name: 'O', email: 'o5@x.com' });
    const task = tasksRepo.create({ title: 'Idempotent', ownerId: owner.id });
    const headers = await authHeaderFor(owner.id);

    await fetch(`${baseUrl}/tasks/${task.id}/collaborators`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: claudeId }),
    });
    await fetch(`${baseUrl}/tasks/${task.id}/collaborators/${claudeId}`, { method: 'DELETE', headers });
    await fetch(`${baseUrl}/tasks/${task.id}/collaborators`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: claudeId }),
    });

    const triggers = getDb().prepare(`SELECT * FROM pending_claude_triggers WHERE task_id = ?`).all(task.id) as any[];
    expect(triggers).toHaveLength(1);
  });
});
