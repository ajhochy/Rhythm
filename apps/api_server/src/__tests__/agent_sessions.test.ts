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
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';

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

  // ── agentId (new field) ────────────────────────────────────────────────────

  it('creates a session when agentId matches a configured, enabled agent', async () => {
    const payload = {
      agentId: 'claude-code',
      cwd: os.homedir(),
      name: 'Test Session',
    };

    const res = await fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(201);
    const session = (await res.json()) as { agentKind: string };
    expect(session.agentKind).toBe('claude-code');
  });

  it('returns 400 when agentId does not exist in agent_configs', async () => {
    const payload = {
      agentId: 'nonexistent',
      cwd: os.homedir(),
      name: 'Ghost Session',
    };

    const res = await fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/agent not configured/i);
  });

  it('returns 400 when agentId refers to a disabled agent config', async () => {
    // Disable the claude-code preset
    new AgentConfigsRepository().update('claude-code', { enabled: false });

    const payload = {
      agentId: 'claude-code',
      cwd: os.homedir(),
      name: 'Disabled Session',
    };

    const res = await fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/agent disabled/i);
  });

  // ── agentKind deprecated fallback ─────────────────────────────────────────

  it('still accepts agentKind as a deprecated fallback', async () => {
    const payload = {
      agentKind: 'claude-code',
      cwd: os.homedir(),
      name: 'Legacy Session',
    };

    const res = await fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(201);
  });

  // ── ~ expansion ────────────────────────────────────────────────────────────

  it('expands ~ in cwd when creating a session', async () => {
    const payload = {
      agentId: 'claude-code',
      cwd: '~/',
      name: 'Test Session',
    };

    const res = await fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(201);
    const session = (await res.json()) as { cwd: string };
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

  // ── legacy agentId alias normalization ───────────────────────────────────

  it('normalizes legacy alias "claude" to "claude-code" and creates the session', async () => {
    const payload = {
      agentId: 'claude',
      cwd: os.homedir(),
      name: 'Legacy Alias Session',
    };

    const res = await fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(201);
    const session = (await res.json()) as { agentKind: string };
    expect(session.agentKind).toBe('claude-code');
  });

  it('returns 400 with structured error for a truly unknown agentId', async () => {
    const payload = {
      agentId: 'unknown-agent',
      cwd: os.homedir(),
      name: 'Unknown Agent Session',
    };

    const res = await fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('BAD_REQUEST');
    expect(body.error.message).toBe("agent not configured: 'unknown-agent'");
  });

  it('does not expand ~ if not at the start', async () => {
    const payload = {
      agentId: 'claude-code',
      cwd: '/some/path/~',
      name: 'Test Session',
    };

    const res = await fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(201);
    const session = (await res.json()) as { cwd: string };
    expect(session.cwd).toBe('/some/path/~');
  });

  it('expands ~ even if it is just ~', async () => {
    const payload = {
      agentId: 'claude-code',
      cwd: '~',
      name: 'Test Session',
    };

    const res = await fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(201);
    const session = (await res.json()) as { cwd: string };
    expect(session.cwd).toBe(os.homedir());
  });
});
