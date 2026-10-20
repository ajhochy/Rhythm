/** A disabled schedule sent by the live UI must remain disabled at rest. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { createApp } from '../app';
import { getDb, setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { SessionsRepository } from '../repositories/sessions_repository';
import { UsersRepository } from '../repositories/users_repository';
import { AgentScheduledTasksRepository } from '../repositories/agent_scheduled_tasks_repository';
import { startTestServer } from './helpers/real_server';

describe('POST /agent-schedules enabled persistence', () => {
  let baseUrl: string;
  let close: () => Promise<void>;
  let headers: Record<string, string>;

  beforeEach(async () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);
    const user = new UsersRepository().create({ name: 'Schedule fixture', email: 'schedule@example.invalid' });
    const session = await new SessionsRepository().createAsync(user.id);
    headers = { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' };
    ({ baseUrl, close } = await startTestServer(createApp()));
  });

  afterEach(async () => {
    await close();
    getDb().close();
  });

  async function createSchedule(extra: Record<string, unknown>) {
    const response = await fetch(`${baseUrl}/agent-schedules`, {
      method: 'POST', headers,
      body: JSON.stringify({
        name: 'Synthetic daily task', scheduleType: 'daily', scheduledTime: '09:00',
        prompt: 'Do not execute; storage-only fixture', ...extra,
      }),
    });
    return { response, body: await response.json() as { id: string; enabled: boolean; error?: { code: string } } };
  }

  it('persists explicit false through POST, GET, list, and due-task selection', async () => {
    const created = await createSchedule({ enabled: false });
    expect(created.response.status).toBe(201);
    expect(created.body.enabled).toBe(false);

    const stored = getDb().prepare('SELECT enabled FROM agent_scheduled_tasks WHERE id = ?')
      .get(created.body.id) as { enabled: number };
    expect(stored.enabled).toBe(0);
    const detail = await fetch(`${baseUrl}/agent-schedules/${created.body.id}`, { headers });
    expect(detail.status).toBe(200);
    expect((await detail.json() as { enabled: boolean }).enabled).toBe(false);
    const list = await fetch(`${baseUrl}/agent-schedules`, { headers });
    expect(list.status).toBe(200);
    expect((await list.json() as Array<{ id: string; enabled: boolean }>)
      .find((task) => task.id === created.body.id)?.enabled).toBe(false);

    await new AgentScheduledTasksRepository().updateNextRunAsync(
      created.body.id, '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z', 'idle',
    );
    expect((await new AgentScheduledTasksRepository().findDueAsync())
      .some((task) => task.id === created.body.id)).toBe(false);
  });

  it('keeps omitted enabled defaulting to true for existing clients', async () => {
    const created = await createSchedule({});
    expect(created.response.status).toBe(201);
    expect(created.body.enabled).toBe(true);
    const stored = getDb().prepare('SELECT enabled FROM agent_scheduled_tasks WHERE id = ?')
      .get(created.body.id) as { enabled: number };
    expect(stored.enabled).toBe(1);
  });

  it('rejects a string enabled value instead of silently enabling a requested disabled schedule', async () => {
    const created = await createSchedule({ enabled: 'false' });
    expect(created.response.status).toBe(400);
    expect(created.body.error?.code).toBe('BAD_REQUEST');
    expect((getDb().prepare('SELECT COUNT(*) AS count FROM agent_scheduled_tasks').get() as { count: number }).count).toBe(0);
  });
});
