import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { createApp } from '../app';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { SessionsRepository } from '../repositories/sessions_repository';
import { UsersRepository } from '../repositories/users_repository';
import { startTestServer } from './helpers/real_server';

describe('hosted write cleanup boundaries', () => {
  let db: Database.Database;
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let ownerHeaders: Record<string, string>;
  let otherHeaders: Record<string, string>;
  let ownerId: number;
  let otherId: number;

  beforeEach(async () => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);
    const users = new UsersRepository();
    const sessions = new SessionsRepository();
    ownerId = users.create({ name: 'Owner', email: 'hosted-owner@example.invalid' }).id;
    otherId = users.create({ name: 'Other', email: 'hosted-other@example.invalid' }).id;
    ownerHeaders = { Authorization: `Bearer ${(await sessions.createAsync(ownerId)).token}` };
    otherHeaders = { Authorization: `Bearer ${(await sessions.createAsync(otherId)).token}` };
    ({ baseUrl, close: closeServer } = await startTestServer(createApp()));
  });

  afterEach(async () => {
    await closeServer();
    db.close();
  });

  it('deletes only a creator-owned thread and cascades its metadata', async () => {
    // CORS answers OPTIONS before Express routing. A creator-scoped DELETE for an
    // impossible, absent ID gives the route's JSON 404 without touching a row.
    const capability = await fetch(`${baseUrl}/message-threads/-2147483648`, { method: 'DELETE', headers: ownerHeaders });
    expect(capability.status).toBe(404);
    expect(await capability.json()).toMatchObject({ error: { code: 'NOT_FOUND', message: 'MessageThread not found' } });
    const malformed = await fetch(`${baseUrl}/message-threads/not-an-id`, { method: 'DELETE', headers: ownerHeaders });
    expect(malformed.status).toBe(404);
    expect(await malformed.json()).toMatchObject({ error: { code: 'NOT_FOUND', message: 'MessageThread not found' } });

    const create = await fetch(`${baseUrl}/message-threads`, {
      method: 'POST', headers: { ...ownerHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ participantIds: [otherId], threadType: 'group', title: 'MEGA-SMOKE-owned-thread' }),
    });
    expect(create.status).toBe(201);
    const thread = await create.json() as { id: number };
    expect(db.prepare('SELECT COUNT(*) AS count FROM thread_participants WHERE thread_id = ?').get(thread.id)).toEqual({ count: 2 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM thread_reads WHERE thread_id = ?').get(thread.id)).toEqual({ count: 2 });

    const participantView = await fetch(`${baseUrl}/message-threads`, { headers: otherHeaders });
    expect((await participantView.json() as Array<{ id: number }>).map((row) => row.id)).toContain(thread.id);

    const denied = await fetch(`${baseUrl}/message-threads/${thread.id}`, { method: 'DELETE', headers: otherHeaders });
    expect(denied.status).toBe(404);
    const stillVisible = await fetch(`${baseUrl}/message-threads`, { headers: ownerHeaders });
    expect((await stillVisible.json() as Array<{ id: number }>).map((row) => row.id)).toContain(thread.id);

    const deleted = await fetch(`${baseUrl}/message-threads/${thread.id}`, { method: 'DELETE', headers: ownerHeaders });
    expect(deleted.status).toBe(204);
    const listed = await fetch(`${baseUrl}/message-threads`, { headers: ownerHeaders });
    expect((await listed.json() as Array<{ id: number }>).map((row) => row.id)).not.toContain(thread.id);
    expect(db.prepare('SELECT COUNT(*) AS count FROM thread_participants WHERE thread_id = ?').get(thread.id)).toEqual({ count: 0 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM thread_reads WHERE thread_id = ?').get(thread.id)).toEqual({ count: 0 });
    expect((await fetch(`${baseUrl}/message-threads/${thread.id}`, { method: 'DELETE', headers: ownerHeaders })).status).toBe(404);
  });

  it('creates a rule paused in its first persisted state and scopes it to its owner', async () => {
    const create = await fetch(`${baseUrl}/automation-rules`, {
      method: 'POST', headers: { ...ownerHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'MEGA-SMOKE-paused-rule', source: 'rhythm', triggerKey: 'rhythm.task_due', actionType: 'create_task', enabled: false }),
    });
    expect(create.status).toBe(201);
    const rule = await create.json() as { id: string; enabled: boolean; ownerId: number };
    expect(rule).toMatchObject({ enabled: false, ownerId });
    expect(db.prepare('SELECT enabled FROM automation_rules WHERE id = ?').get(rule.id)).toEqual({ enabled: 0 });
    const ownRead = await fetch(`${baseUrl}/automation-rules/${rule.id}`, { headers: ownerHeaders });
    expect((await ownRead.json() as { enabled: boolean }).enabled).toBe(false);
    const foreignRead = await fetch(`${baseUrl}/automation-rules/${rule.id}`, { headers: otherHeaders });
    expect(foreignRead.status).toBe(404);
    const deleted = await fetch(`${baseUrl}/automation-rules/${rule.id}`, { method: 'DELETE', headers: ownerHeaders });
    expect(deleted.status).toBe(204);
    expect((await fetch(`${baseUrl}/automation-rules/${rule.id}`, { headers: ownerHeaders })).status).toBe(404);
  });
});
