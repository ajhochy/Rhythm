/** Local schedule creation must use server-verified identity, including paired mobile. */
import Database from 'better-sqlite3';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { startTestServer } from './helpers/real_server';

type CreatedSchedule = { id: string; createdByUserId: number | null };

describe('AGENT_LOCAL schedule owner attribution', () => {
  const previousAgentLocal = process.env.AGENT_LOCAL;
  let createApp: typeof import('../app')['createApp'];
  let setDb: typeof import('../database/db')['setDb'];
  let runMigrations: typeof import('../database/migrations')['runMigrations'];
  let UsersRepository: typeof import('../repositories/users_repository')['UsersRepository'];
  let SessionsRepository: typeof import('../repositories/sessions_repository')['SessionsRepository'];
  let installHumanApprovalTestCredentials: typeof import('./helpers/human_approval_test_credentials')['installHumanApprovalTestCredentials'];
  let db: Database.Database;
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let first: { id: number; token: string };
  let second: { id: number; token: string };

  beforeAll(async () => {
    process.env.AGENT_LOCAL = 'true';
    vi.resetModules();
    ({ createApp } = await import('../app'));
    ({ setDb } = await import('../database/db'));
    ({ runMigrations } = await import('../database/migrations'));
    ({ UsersRepository } = await import('../repositories/users_repository'));
    ({ SessionsRepository } = await import('../repositories/sessions_repository'));
    ({ installHumanApprovalTestCredentials } = await import('./helpers/human_approval_test_credentials'));
    expect((await import('../config/env')).env.agentLocal).toBe(true);
  });

  afterAll(() => {
    if (previousAgentLocal === undefined) delete process.env.AGENT_LOCAL;
    else process.env.AGENT_LOCAL = previousAgentLocal;
    vi.resetModules();
  });

  beforeEach(async () => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);
    const users = new UsersRepository();
    const sessions = new SessionsRepository();
    const firstUser = users.create({ name: 'First local owner', email: 'schedule-first@example.invalid' });
    const secondUser = users.create({ name: 'Second local owner', email: 'schedule-second@example.invalid' });
    first = { id: firstUser.id, token: sessions.create(firstUser.id).token };
    second = { id: secondUser.id, token: sessions.create(secondUser.id).token };
    ({ baseUrl, close: closeServer } = await startTestServer(createApp()));
  });

  afterEach(async () => {
    await closeServer();
    db.close();
  });

  function createSchedule(path: string, authorization?: string, extra: Record<string, unknown> = {}) {
    return fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authorization ? { Authorization: authorization } : {}),
      },
      body: JSON.stringify({
        name: 'Synthetic owner attribution task',
        scheduleType: 'daily', scheduledTime: '09:00',
        prompt: 'Storage-only fixture; never run this schedule',
        enabled: false,
        ...extra,
      }),
    });
  }

  function storedOwner(id: string): number | null {
    return (db.prepare('SELECT created_by_user_id FROM agent_scheduled_tasks WHERE id = ?')
      .get(id) as { created_by_user_id: number | null }).created_by_user_id;
  }

  it('uses the verified local Bearer owner and ignores a forged body owner', async () => {
    const response = await createSchedule('/agent-schedules', `Bearer ${first.token}`, {
      createdByUserId: second.id,
    });
    expect(response.status).toBe(201);
    const created = await response.json() as CreatedSchedule;
    expect(created.createdByUserId).toBe(first.id);
    expect(storedOwner(created.id)).toBe(first.id);
  });

  it('rejects a present invalid Bearer rather than creating an anonymous row', async () => {
    const response = await createSchedule('/agent-schedules', 'Bearer invalid-synthetic-token');
    expect(response.status).toBe(401);
    expect((db.prepare('SELECT COUNT(*) AS count FROM agent_scheduled_tasks').get() as { count: number }).count).toBe(0);
  });

  it('keeps an ambiguous no-Bearer local request unattributed', async () => {
    const response = await createSchedule('/agent-schedules', undefined, { createdByUserId: first.id });
    expect(response.status).toBe(201);
    const created = await response.json() as CreatedSchedule;
    expect(created.createdByUserId).toBeNull();
    expect(storedOwner(created.id)).toBeNull();
  });

  it('preserves the verified Device owner on the paired mobile route', async () => {
    const human = installHumanApprovalTestCredentials();
    const codeResponse = await fetch(`${baseUrl}/mobile-gateway/pairing-codes`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${first.token}`, 'Content-Type': 'application/json', ...human.capabilityHeader },
      body: '{}',
    });
    expect(codeResponse.status).toBe(201);
    const code = await codeResponse.json() as { pairingCode: string; hostId: string };
    const pairResponse = await fetch(`${baseUrl}/mobile-gateway/pair`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pairingCode: code.pairingCode, hostId: code.hostId, deviceName: 'Synthetic device' }),
    });
    expect(pairResponse.status).toBe(201);
    const { deviceToken } = await pairResponse.json() as { deviceToken: string };

    const response = await createSchedule('/mobile-gateway/tools/agent-schedules', `Device ${deviceToken}`, {
      createdByUserId: second.id,
    });
    expect(response.status).toBe(201);
    const created = await response.json() as CreatedSchedule;
    expect(created.createdByUserId).toBe(first.id);
    expect(storedOwner(created.id)).toBe(first.id);
  });
});
