import type { AddressInfo } from 'node:net';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import { createApp } from '../app';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { NotificationsRepository } from '../repositories/notifications_repository';
import { NotificationService } from '../services/notification_service';
import { SessionsRepository } from '../repositories/sessions_repository';
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

describe('NotificationsRepository', () => {
  let repo: NotificationsRepository;
  let usersRepo: UsersRepository;

  beforeEach(() => {
    const db = makeDb();
    setDb(db);
    repo = new NotificationsRepository();
    usersRepo = new UsersRepository();
  });

  it('inserts and lists unread notifications', () => {
    const user = usersRepo.create({ name: 'Alice', email: 'alice@example.com' });
    repo.insert({
      recipientUserId: user.id,
      type: 'task_assigned',
      entityType: 'task',
      entityId: 'task-1',
      message: 'You were assigned to "Fix bug"',
    });
    const notifs = repo.listUnread(user.id);
    expect(notifs).toHaveLength(1);
    expect(notifs[0].message).toBe('You were assigned to "Fix bug"');
    expect(notifs[0].readAt).toBeNull();
  });

  it('markRead hides notification from listUnread', () => {
    const user = usersRepo.create({ name: 'Bob', email: 'bob@example.com' });
    repo.insert({
      recipientUserId: user.id,
      type: 'collaborator_added',
      entityType: 'rhythm',
      entityId: 'rule-1',
      message: 'You were added as a collaborator on "Sunday Prep"',
    });
    const before = repo.listUnread(user.id);
    expect(before).toHaveLength(1);
    repo.markRead(before[0].id, user.id);
    expect(repo.listUnread(user.id)).toHaveLength(0);
  });

  it('markAllRead clears all unread for that user only', () => {
    const alice = usersRepo.create({ name: 'Alice', email: 'alice2@example.com' });
    const bob = usersRepo.create({ name: 'Bob', email: 'bob2@example.com' });
    repo.insert({ recipientUserId: alice.id, type: 'task_assigned', entityType: 'task', entityId: 't1', message: 'msg1' });
    repo.insert({ recipientUserId: alice.id, type: 'step_completed', entityType: 'project', entityId: 'p1', message: 'msg2' });
    repo.insert({ recipientUserId: bob.id, type: 'task_assigned', entityType: 'task', entityId: 't2', message: 'msg3' });
    repo.markAllRead(alice.id);
    expect(repo.listUnread(alice.id)).toHaveLength(0);
    expect(repo.listUnread(bob.id)).toHaveLength(1);
  });

  it('does not return notifications for other users', () => {
    const alice = usersRepo.create({ name: 'Alice', email: 'alice3@example.com' });
    const bob = usersRepo.create({ name: 'Bob', email: 'bob3@example.com' });
    repo.insert({ recipientUserId: alice.id, type: 'task_assigned', entityType: 'task', entityId: 't1', message: 'For Alice' });
    expect(repo.listUnread(bob.id)).toHaveLength(0);
  });
});

describe('NotificationService', () => {
  let repo: NotificationsRepository;
  let service: NotificationService;
  let usersRepo: UsersRepository;

  beforeEach(() => {
    const db = makeDb();
    setDb(db);
    repo = new NotificationsRepository();
    service = new NotificationService(repo);
    usersRepo = new UsersRepository();
  });

  it('notifyTaskAssignedAsync skips self-notification', async () => {
    const user = usersRepo.create({ name: 'Alice', email: 'alice@svc.com' });
    await service.notifyTaskAssignedAsync('t1', 'Fix bug', user.id, user.id);
    expect(repo.listUnread(user.id)).toHaveLength(0);
  });

  it('notifyTaskAssignedAsync notifies when actor !== recipient', async () => {
    const alice = usersRepo.create({ name: 'Alice', email: 'alice@svc2.com' });
    const bob = usersRepo.create({ name: 'Bob', email: 'bob@svc2.com' });
    await service.notifyTaskAssignedAsync('t1', 'Fix bug', alice.id, bob.id);
    const notifs = repo.listUnread(alice.id);
    expect(notifs).toHaveLength(1);
    expect(notifs[0].type).toBe('task_assigned');
  });

  it('notifyCollaboratorAddedAsync skips actor', async () => {
    const user = usersRepo.create({ name: 'Alice', email: 'alice@svc3.com' });
    await service.notifyCollaboratorAddedAsync('rhythm', 'r1', 'Sunday Prep', user.id, user.id);
    expect(repo.listUnread(user.id)).toHaveLength(0);
  });

  it('notifyStepCompletedAsync fans out to collaborators except actor', async () => {
    const alice = usersRepo.create({ name: 'Alice', email: 'alice@svc4.com' });
    const bob = usersRepo.create({ name: 'Bob', email: 'bob@svc4.com' });
    const carol = usersRepo.create({ name: 'Carol', email: 'carol@svc4.com' });
    await service.notifyStepCompletedAsync('project', 'p1', 'Easter Service', 'Print bulletins', [alice.id, bob.id, carol.id], alice.id);
    expect(repo.listUnread(alice.id)).toHaveLength(0); // actor excluded
    expect(repo.listUnread(bob.id)).toHaveLength(1);
    expect(repo.listUnread(carol.id)).toHaveLength(1);
  });

  it('notifyStepDueAsync inserts a step_due notification', async () => {
    const user = usersRepo.create({ name: 'Alice', email: 'alice@svc5.com' });
    await service.notifyStepDueAsync('r1', 'Sunday Prep', 'Prep charts', user.id);
    const notifs = repo.listUnread(user.id);
    expect(notifs).toHaveLength(1);
    expect(notifs[0].type).toBe('step_due');
  });
});

describe('Notifications HTTP API', () => {
  let usersRepo: UsersRepository;
  let sessionsRepo: SessionsRepository;
  let notifRepo: NotificationsRepository;
  let baseUrl: string;
  let closeServer: () => Promise<void>;

  beforeEach(async () => {
    const db = makeDb();
    setDb(db);
    usersRepo = new UsersRepository();
    sessionsRepo = new SessionsRepository();
    notifRepo = new NotificationsRepository();

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

  it('GET /notifications returns 401 without auth', async () => {
    const res = await fetch(`${baseUrl}/notifications`);
    expect(res.status).toBe(401);
  });

  it('GET /notifications returns empty array for new user', async () => {
    const user = usersRepo.create({ name: 'Alice', email: 'alice@http.com' });
    const headers = await authHeaderFor(user.id);
    const res = await fetch(`${baseUrl}/notifications`, { headers });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body).toEqual([]);
  });

  it('GET /notifications returns unread notifications', async () => {
    const user = usersRepo.create({ name: 'Alice', email: 'alice@http2.com' });
    notifRepo.insert({ recipientUserId: user.id, type: 'task_assigned', entityType: 'task', entityId: 't1', message: 'You were assigned' });
    const headers = await authHeaderFor(user.id);
    const res = await fetch(`${baseUrl}/notifications`, { headers });
    const body = await readJson(res);
    expect(body).toHaveLength(1);
    expect(body[0].message).toBe('You were assigned');
  });

  it('POST /notifications/read-all clears all unread', async () => {
    const user = usersRepo.create({ name: 'Alice', email: 'alice@http3.com' });
    notifRepo.insert({ recipientUserId: user.id, type: 'task_assigned', entityType: 'task', entityId: 't1', message: 'msg1' });
    notifRepo.insert({ recipientUserId: user.id, type: 'step_completed', entityType: 'project', entityId: 'p1', message: 'msg2' });
    const headers = await authHeaderFor(user.id);
    const markRes = await fetch(`${baseUrl}/notifications/read-all`, { method: 'POST', headers });
    expect(markRes.status).toBe(204);
    const getRes = await fetch(`${baseUrl}/notifications`, { headers });
    const body = await readJson(getRes);
    expect(body).toHaveLength(0);
  });
});
