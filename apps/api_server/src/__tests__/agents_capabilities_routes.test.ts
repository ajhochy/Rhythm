import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createApp } from '../app';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { UsersRepository } from '../repositories/users_repository';
import { SessionsRepository } from '../repositories/sessions_repository';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import type { AddressInfo } from 'node:net';

// Mock child_process.exec so we can control `which` output in tests without
// hitting the real filesystem PATH.
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    exec: vi.fn() as any,
  };
});

import { exec } from 'child_process';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockExec = exec as unknown as ReturnType<typeof vi.fn>;

type ExecCallback = (err: Error | null, stdout: string, stderr: string) => void;

function makeExecImpl(stdout: string, err?: Error) {
  return (_cmd: string, callback: ExecCallback) => {
    callback(err ?? null, stdout, '');
  };
}

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

function makeServer() {
  return createApp().listen(0);
}

async function setup() {
  const db = makeDb();
  setDb(db);

  const usersRepo = new UsersRepository();
  const sessionsRepo = new SessionsRepository();
  const user = usersRepo.create({ name: 'Test User', email: 'test@example.com' });
  const session = await sessionsRepo.createAsync(user.id);
  const authHeaders: Record<string, string> = {
    Authorization: `Bearer ${session.token}`,
    'Content-Type': 'application/json',
  };

  const server = makeServer();
  await new Promise<void>((r) => server.once('listening', () => r()));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const closeServer = () =>
    new Promise<void>((res, rej) => server.close((e) => (e ? rej(e) : res())));

  return { baseUrl, closeServer, authHeaders };
}

describe('GET /agents/capabilities', () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let authHeaders: Record<string, string>;

  beforeEach(async () => {
    ({ baseUrl, closeServer, authHeaders } = await setup());
    // Default: all binaries found
    mockExec.mockImplementation(makeExecImpl('/usr/local/bin/fake\n'));
  });

  afterEach(async () => {
    await closeServer();
    vi.clearAllMocks();
  });

  it('returns a key for every enabled config', async () => {
    const res = await fetch(`${baseUrl}/agents/capabilities`, { headers: authHeaders });
    expect(res.status).toBe(200);
    const caps = (await res.json()) as Record<string, boolean>;

    // After migrations the seeded presets (claude-code, codex, gemini-cli, opencode) are all enabled
    expect(typeof caps['claude-code']).toBe('boolean');
    expect(typeof caps['codex']).toBe('boolean');
    expect(typeof caps['gemini-cli']).toBe('boolean');
    expect(typeof caps['opencode']).toBe('boolean');
  });

  it('returns true when which succeeds', async () => {
    mockExec.mockImplementation(makeExecImpl('/usr/local/bin/claude\n'));

    const res = await fetch(`${baseUrl}/agents/capabilities`, { headers: authHeaders });
    const caps = (await res.json()) as Record<string, boolean>;
    expect(caps['claude-code']).toBe(true);
  });

  it('returns false when which fails (exit non-zero)', async () => {
    mockExec.mockImplementation(makeExecImpl('', new Error('not found')));

    const res = await fetch(`${baseUrl}/agents/capabilities`, { headers: authHeaders });
    const caps = (await res.json()) as Record<string, boolean>;
    expect(caps['claude-code']).toBe(false);
    expect(caps['codex']).toBe(false);
  });

  it('omits a config that is disabled', async () => {
    // Disable claude-code
    const repo = new AgentConfigsRepository();
    repo.update('claude-code', { enabled: false });

    const res = await fetch(`${baseUrl}/agents/capabilities`, { headers: authHeaders });
    const caps = (await res.json()) as Record<string, boolean>;
    expect('claude-code' in caps).toBe(false);
    // Others still present
    expect('codex' in caps).toBe(true);
  });

  it('includes a newly created custom config when enabled', async () => {
    const repo = new AgentConfigsRepository();
    repo.insert({ label: 'My Custom Agent', icon: '', command: 'mycustomagent --run', enabled: true });

    const res = await fetch(`${baseUrl}/agents/capabilities`, { headers: authHeaders });
    const caps = (await res.json()) as Record<string, boolean>;

    // The custom agent id is auto-generated UUID; find it by scanning keys
    const ids = Object.keys(caps);
    // Should have 5 keys (4 presets + 1 custom)
    expect(ids.length).toBe(5);
  });
});

describe('POST /agents/capabilities/refresh', () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let authHeaders: Record<string, string>;

  beforeEach(async () => {
    ({ baseUrl, closeServer, authHeaders } = await setup());
    mockExec.mockImplementation(makeExecImpl('/usr/local/bin/fake\n'));
  });

  afterEach(async () => {
    await closeServer();
    vi.clearAllMocks();
  });

  it('returns the same shape as GET /', async () => {
    const res = await fetch(`${baseUrl}/agents/capabilities/refresh`, {
      method: 'POST',
      headers: authHeaders,
    });
    expect(res.status).toBe(200);
    const caps = (await res.json()) as Record<string, boolean>;
    expect(typeof caps['claude-code']).toBe('boolean');
    expect(typeof caps['codex']).toBe('boolean');
  });

  it('reflects fresh state after a config change', async () => {
    // Disable codex between calls
    const repo = new AgentConfigsRepository();

    const getRes = await fetch(`${baseUrl}/agents/capabilities`, { headers: authHeaders });
    const before = (await getRes.json()) as Record<string, boolean>;
    expect('codex' in before).toBe(true);

    repo.update('codex', { enabled: false });

    const refreshRes = await fetch(`${baseUrl}/agents/capabilities/refresh`, {
      method: 'POST',
      headers: authHeaders,
    });
    const after = (await refreshRes.json()) as Record<string, boolean>;
    expect('codex' in after).toBe(false);
  });
});
