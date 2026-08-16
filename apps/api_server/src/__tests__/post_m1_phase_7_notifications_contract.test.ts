import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startTestServer } from './helpers/real_server';

const broadcast = vi.fn();
vi.mock('../services/ws_gateway', () => ({
  broadcast,
  broadcastSessionUpdated: vi.fn(),
  broadcastSessionRemoved: vi.fn(),
  broadcastAgentConfigsChanged: vi.fn(),
}));

describe('post-m1 Phase 7 canonical notification creation contract', () => {
  let db: Database.Database;
  let baseUrl: string;
  let closeServer: () => Promise<void>;

  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv('AGENT_LOCAL', 'true');
    const { setDb } = await import('../database/db');
    const { runMigrations } = await import('../database/migrations');
    const { createApp } = await import('../app');
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);
    ({ baseUrl, close: closeServer } = await startTestServer(createApp()));
    broadcast.mockClear();
  });

  afterEach(async () => {
    await closeServer();
    db.close();
    vi.unstubAllEnvs();
  });

  it('post-m1-p7-c4a-domain: a domain event persists exactly one canonical recipient row', async () => {
    // Regression caught: notification creation duplicates a row or stores display aliases.
    const { UsersRepository } = await import('../repositories/users_repository');
    const { NotificationService } = await import('../services/notification_service');
    const { NotificationsRepository } = await import('../repositories/notifications_repository');
    const users = new UsersRepository();
    const actor = users.create({ name: 'Actor', email: 'phase-7-actor@example.invalid' });
    const recipient = users.create({ name: 'Recipient', email: 'phase-7-recipient@example.invalid' });
    const repo = new NotificationsRepository();
    await new NotificationService(repo).notifyTaskAssignedAsync('task-7', 'Phase 7 task', recipient.id, actor.id);

    expect(await repo.listUnreadAsync(recipient.id)).toEqual([{
      id: expect.any(Number),
      recipientUserId: recipient.id,
      type: 'task_assigned',
      entityType: 'task',
      entityId: 'task-7',
      message: 'You were assigned to "Phase 7 task"',
      readAt: null,
      createdAt: expect.any(String),
    }]);
  });

  it('post-m1-p7-c4a-agent: agent creation broadcasts one bounded canonical notification.push frame', async () => {
    // Regression caught: agent pushes use a noncanonical frame, exceed bounds, or broadcast twice.
    const response = await fetch(`${baseUrl}/notifications/agent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Phase 7 title', body: 'Phase 7 body' }),
    });
    expect(response.status).toBe(201);
    const created = await response.json() as { id: number };
    expect(created.id).toEqual(expect.any(Number));
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast).toHaveBeenCalledWith({
      v: 1,
      type: 'notification.push',
      id: created.id,
      title: 'Phase 7 title',
      body: 'Phase 7 body',
    });
    expect(db.prepare('SELECT id, title, body FROM agent_notifications').all()).toEqual([{
      id: created.id,
      title: 'Phase 7 title',
      body: 'Phase 7 body',
    }]);

    const tooLong = await fetch(`${baseUrl}/notifications/agent`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'x'.repeat(201), body: 'bounded' }),
    });
    expect(tooLong.status).toBe(400);
    expect(broadcast).toHaveBeenCalledTimes(1);
  });
});
