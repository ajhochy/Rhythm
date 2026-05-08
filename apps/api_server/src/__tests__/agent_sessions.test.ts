import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'os';
import Database from 'better-sqlite3';
import { createApp } from '../app';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import * as ptyRunner from '../services/pty_runner';
import type { AddressInfo } from 'node:net';
import { UsersRepository } from '../repositories/users_repository';
import { SessionsRepository } from '../repositories/sessions_repository';

vi.mock('../services/pty_runner', () => ({
  spawn: vi.fn(),
  kill: vi.fn(),
  isAlive: vi.fn(),
  resume: vi.fn(),
  getBuffer: vi.fn(),
  listAlive: vi.fn(),
}));

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

describe('Agent Sessions API', () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let usersRepo: UsersRepository;
  let sessionsRepo: SessionsRepository;
  let authHeaders: Record<string, string>;

  beforeEach(async () => {
    setDb(makeDb());
    usersRepo = new UsersRepository();
    sessionsRepo = new SessionsRepository();

    const user = usersRepo.create({ name: 'Test User', email: 'test@example.com' });
    const session = await sessionsRepo.createAsync(user.id);
    authHeaders = { 
      'Authorization': `Bearer ${session.token}`,
      'Content-Type': 'application/json'
    };

    const server = createApp().listen(0);
    await new Promise<void>((r) => server.once('listening', () => r()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    closeServer = () => new Promise<void>((res, rej) => server.close((e) => e ? rej(e) : res()));
  });

  afterEach(async () => {
    await closeServer();
    vi.clearAllMocks();
  });

  it('expands ~ in cwd when creating a session', async () => {
    const payload = {
      agentKind: 'claude-code',
      cwd: '~/',
      name: 'Test Session',
    };

    const res = await fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(201);
    const session = await res.json() as Record<string, unknown>;
    const expectedCwd = os.homedir() + '/';
    expect(session.cwd).toBe(expectedCwd);
    
    expect(ptyRunner.spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        session: expect.objectContaining({
          cwd: expectedCwd,
        }),
      })
    );
  });

  it('does not expand ~ if not at the start', async () => {
    const payload = {
      agentKind: 'claude-code',
      cwd: '/some/path/~',
      name: 'Test Session',
    };

    const res = await fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(201);
    const session = await res.json() as Record<string, unknown>;
    expect(session.cwd).toBe('/some/path/~');
  });

  it('expands ~ even if it is just ~', async () => {
    const payload = {
      agentKind: 'claude-code',
      cwd: '~',
      name: 'Test Session',
    };

    const res = await fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(201);
    const session = await res.json() as Record<string, unknown>;
    expect(session.cwd).toBe(os.homedir());
  });
});
