import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import Database from 'better-sqlite3';
import { createApp } from '../app';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { UsersRepository } from '../repositories/users_repository';
import { SessionsRepository } from '../repositories/sessions_repository';

// Prevent real WS broadcast in tests
vi.mock('../services/ws_gateway', () => ({
  broadcast: vi.fn(),
  attachWsGateway: vi.fn(),
}));

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

describe('POST /notifications/agent', () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let authHeaders: Record<string, string>;

  beforeEach(async () => {
    setDb(makeDb());

    const usersRepo = new UsersRepository();
    const sessionsRepo = new SessionsRepository();
    const user = usersRepo.create({ name: 'Test User', email: 'test@example.com' });
    const session = await sessionsRepo.createAsync(user.id);
    authHeaders = {
      Authorization: `Bearer ${session.token}`,
      'Content-Type': 'application/json',
    };

    const server = createApp().listen(0);
    await new Promise<void>((r) => server.once('listening', () => r()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    closeServer = () =>
      new Promise<void>((res, rej) =>
        server.close((e) => (e ? rej(e) : res())),
      );
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await closeServer();
  });

  it('returns 401 without auth', async () => {
    const res = await fetch(`${baseUrl}/notifications/agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Done', body: 'Task complete' }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 201 and id with valid payload', async () => {
    const res = await fetch(`${baseUrl}/notifications/agent`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ title: 'Done', body: 'Refactor complete' }),
    });
    expect(res.status).toBe(201);
    const data = (await res.json()) as { id: number };
    expect(typeof data.id).toBe('number');
    expect(data.id).toBeGreaterThan(0);
  });

  it('broadcasts notification.push via WebSocket', async () => {
    const { broadcast } = await import('../services/ws_gateway');
    await fetch(`${baseUrl}/notifications/agent`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ title: 'Claude done', body: 'All tests pass' }),
    });
    expect(broadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'notification.push',
        title: 'Claude done',
        body: 'All tests pass',
      }),
    );
  });

  it('returns 400 when title is missing', async () => {
    const res = await fetch(`${baseUrl}/notifications/agent`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ body: 'No title here' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when body is missing', async () => {
    const res = await fetch(`${baseUrl}/notifications/agent`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ title: 'Done' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when title exceeds 200 chars', async () => {
    const res = await fetch(`${baseUrl}/notifications/agent`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ title: 'x'.repeat(201), body: 'ok' }),
    });
    expect(res.status).toBe(400);
  });
});
