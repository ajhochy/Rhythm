import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'os';
import Database from 'better-sqlite3';
import { createApp } from '../app';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import type { AddressInfo } from 'node:net';
import { UsersRepository } from '../repositories/users_repository';
import { SessionsRepository } from '../repositories/sessions_repository';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';

// Mock the Opencode engine so we can control SDK availability in tests without
// requiring a real Opencode SDK connection.
vi.mock('../services/opencode_engine', () => {
  let _ready = true;
  const mockClient = {
    get isReady() { return _ready; },
    set isReady(v: boolean) { _ready = v; },
    listProviders: vi.fn().mockResolvedValue(['anthropic', 'openai']),
    statusMessage: 'Opencode SDK ready',
    createSession: vi.fn().mockResolvedValue({ id: 'sdk-session-1' }),
    setAuth: vi.fn().mockResolvedValue(true),
    prompt: vi.fn().mockResolvedValue({}),
    subscribeToEvents: vi.fn().mockResolvedValue(null),
  };
  return {
    opencodeClient: mockClient,
    opencodeSessionMap: new Map<string, string>(),
  };
});

// Mock the stream bridge — session streaming doesn't need real SSE in tests
vi.mock('../services/opencode_stream_bridge', () => ({
  streamBridge: {
    streamSession: vi.fn().mockResolvedValue(undefined),
    stopStream: vi.fn(),
    dispose: vi.fn(),
  },
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
      agentId: 'nonexistent-agent',
      cwd: os.homedir(),
      name: 'Test',
    };

    const res = await fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(400);
  });

  it('returns 400 when agent is disabled', async () => {
    // Disable claude-code
    new AgentConfigsRepository().update('claude-code', { enabled: false });

    const payload = {
      agentId: 'claude-code',
      cwd: os.homedir(),
      name: 'Test',
    };

    const res = await fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(400);
  });

  it('returns 400 when the Opencode engine is not ready', async () => {
    const { opencodeClient } = await import('../services/opencode_engine');
    (opencodeClient as { isReady: boolean }).isReady = false;

    const payload = {
      agentId: 'claude-code',
      cwd: os.homedir(),
      name: 'Test',
    };

    const res = await fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(400);
  });

  it('uses the deprecated agentKind when agentId is not provided', async () => {
    const payload = {
      agentKind: 'codex',
      cwd: os.homedir(),
      name: 'Legacy Session',
    };

    const res = await fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(201);
    const session = (await res.json()) as { agentKind?: string };
    expect(session.agentKind).toBe('codex');
  });

  it('deletes a session', async () => {
    // Create first
    const createRes = await fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ agentId: 'claude-code', cwd: os.homedir(), name: 'To Delete' }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id: string };

    // Delete
    const delRes = await fetch(`${baseUrl}/agent-sessions/${created.id}`, {
      method: 'DELETE',
      headers: authHeaders,
    });

    expect(delRes.status).toBe(204);
  });

  it('lists sessions', async () => {
    const res = await fetch(`${baseUrl}/agent-sessions`, { headers: authHeaders });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sessions: unknown[] };
    expect(Array.isArray(body.sessions)).toBe(true);
  });

  it('returns messages for a session', async () => {
    // Create a session first
    const createRes = await fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ agentId: 'claude-code', cwd: os.homedir(), name: 'Messages Test' }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id: string };

    // Get messages (should be empty for a new session)
    const msgsRes = await fetch(`${baseUrl}/agent-sessions/${created.id}/messages`, { headers: authHeaders });
    expect(msgsRes.status).toBe(200);
    const msgsBody = (await msgsRes.json()) as { messages: unknown[] };
    expect(Array.isArray(msgsBody.messages)).toBe(true);
  });
});
