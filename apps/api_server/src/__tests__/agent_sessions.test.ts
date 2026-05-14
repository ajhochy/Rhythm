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
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';

// Mock the Opencode engine so we can control SDK availability in tests without
// requiring a real Opencode SDK connection.
vi.mock('../services/opencode_engine', () => {
  let _ready = true;
  const mockClient = {
    get isReady() { return _ready; },
    set isReady(v: boolean) { _ready = v; },
    listProviders: vi.fn().mockResolvedValue(['anthropic', 'openai']),
    listAuthedProviders: vi.fn().mockResolvedValue(['anthropic', 'openai']),
    statusMessage: 'Opencode SDK ready',
    createSession: vi.fn().mockResolvedValue({ id: 'sdk-session-1' }),
    setAuth: vi.fn().mockResolvedValue(true),
    prompt: vi.fn().mockResolvedValue({}),
    promptAsync: vi.fn().mockResolvedValue(true),
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
    // Reset the isReady closure state so subsequent tests start with a ready engine.
    // vi.clearAllMocks() only resets call counts — it does not reset the _ready closure.
    const { opencodeClient } = await import('../services/opencode_engine');
    (opencodeClient as { isReady: boolean }).isReady = true;
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

  // ── resume ────────────────────────────────────────────────────────────────

  it('resumes a resumable session by creating a fresh SDK session, mapping it, and starting the bridge', async () => {
    const sessionsRepoLocal = new AgentSessionsRepository();
    const inserted = sessionsRepoLocal.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: os.homedir(),
      name: 'Resumable Session',
    });
    sessionsRepoLocal.updateToken(inserted.id, 'sdk-prior-token');
    sessionsRepoLocal.updateStatus(inserted.id, 'resumable');

    const { opencodeClient, opencodeSessionMap } = await import('../services/opencode_engine');
    const { streamBridge } = await import('../services/opencode_stream_bridge');
    const mockClient = opencodeClient as unknown as { createSession: ReturnType<typeof vi.fn> };
    mockClient.createSession.mockResolvedValueOnce({ id: 'sdk-resumed-session' });

    const res = await fetch(`${baseUrl}/agent-sessions/${inserted.id}/resume`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ agentId: 'claude-code' }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; status: string };
    expect(body.id).toBe(inserted.id);
    expect(body.status).toBe('starting');
    expect(mockClient.createSession).toHaveBeenCalled();
    expect(opencodeSessionMap.get(inserted.id)).toBe('sdk-resumed-session');
    expect(streamBridge.streamSession).toHaveBeenCalledWith(
      inserted.id,
      'sdk-resumed-session',
      expect.any(String),
    );

    // DELETE should clear the mapping
    const delRes = await fetch(`${baseUrl}/agent-sessions/${inserted.id}`, {
      method: 'DELETE',
      headers: authHeaders,
    });
    expect(delRes.status).toBe(204);
    expect(opencodeSessionMap.has(inserted.id)).toBe(false);
  });

  it('returns 400 when resuming a session that is not in resumable status', async () => {
    const sessionsRepoLocal = new AgentSessionsRepository();
    const inserted = sessionsRepoLocal.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: os.homedir(),
      name: 'Not Resumable',
    });
    // status is 'starting' from insert default — no token, not resumable

    const res = await fetch(`${baseUrl}/agent-sessions/${inserted.id}/resume`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ agentId: 'claude-code' }),
    });

    expect(res.status).toBe(400);
  });

  // ── legacy agentId alias normalization (from origin/main) ───────────────

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

    // The session creates successfully with the literal path. We're not
    // expanding `~` mid-path (only at the start), so the cwd that ends up
    // stored should be the unmodified input — confirming no expansion.
    expect(res.status).toBe(201);
    const created = (await res.json()) as { cwd: string };
    expect(created.cwd).toBe('/some/path/~');
  });

  it('returns 400 on resume when the Opencode engine is not ready', async () => {
    const sessionsRepoLocal = new AgentSessionsRepository();
    const inserted = sessionsRepoLocal.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: os.homedir(),
      name: 'Resumable Engine Down',
    });
    sessionsRepoLocal.updateToken(inserted.id, 'sdk-prior-token');
    sessionsRepoLocal.updateStatus(inserted.id, 'resumable');

    const { opencodeClient } = await import('../services/opencode_engine');
    (opencodeClient as { isReady: boolean }).isReady = false;

    const res = await fetch(`${baseUrl}/agent-sessions/${inserted.id}/resume`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ agentId: 'claude-code' }),
    });

    expect(res.status).toBe(400);
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

  // ── M1-2 #587: project_id FK + filtering ──────────────────────────────────

  async function createProject(name: string, cwd: string): Promise<string> {
    const res = await fetch(`${baseUrl}/projects`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ name, cwd }),
    });
    const project = (await res.json()) as { id: string };
    return project.id;
  }

  it('POST /agent-sessions without projectId persists NULL', async () => {
    const res = await fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ agentId: 'claude-code', cwd: os.homedir(), name: 'No project' }),
    });
    expect(res.status).toBe(201);
    const session = (await res.json()) as { projectId: string | null };
    expect(session.projectId).toBeNull();
  });

  it('POST /agent-sessions with explicit projectId persists it', async () => {
    const projectId = await createProject('Proj A', os.homedir());
    const res = await fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        agentId: 'claude-code',
        cwd: os.homedir(),
        name: 'In project',
        projectId,
      }),
    });
    expect(res.status).toBe(201);
    const session = (await res.json()) as { projectId: string | null };
    expect(session.projectId).toBe(projectId);
  });

  it('GET /agent-sessions?projectId=<id> filters by project', async () => {
    const projectId = await createProject('Filter', os.homedir());
    await fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ agentId: 'claude-code', cwd: os.homedir(), name: 'In', projectId }),
    });
    await fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ agentId: 'claude-code', cwd: os.homedir(), name: 'Out' }),
    });

    const res = await fetch(`${baseUrl}/agent-sessions?projectId=${projectId}`, {
      headers: authHeaders,
    });
    const body = (await res.json()) as { sessions: Array<{ name: string; projectId: string | null }> };
    expect(body.sessions.every((s) => s.projectId === projectId)).toBe(true);
    expect(body.sessions.find((s) => s.name === 'In')).toBeDefined();
    expect(body.sessions.find((s) => s.name === 'Out')).toBeUndefined();
  });

  it('GET /agent-sessions?projectId=null returns only unassigned sessions', async () => {
    const projectId = await createProject('Nullbucket', os.homedir());
    await fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ agentId: 'claude-code', cwd: os.homedir(), name: 'AssignedX', projectId }),
    });
    await fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ agentId: 'claude-code', cwd: os.homedir(), name: 'UnassignedY' }),
    });

    const res = await fetch(`${baseUrl}/agent-sessions?projectId=null`, { headers: authHeaders });
    const body = (await res.json()) as { sessions: Array<{ name: string; projectId: string | null }> };
    expect(body.sessions.every((s) => s.projectId === null)).toBe(true);
    expect(body.sessions.find((s) => s.name === 'UnassignedY')).toBeDefined();
    expect(body.sessions.find((s) => s.name === 'AssignedX')).toBeUndefined();
  });

  it('projects migration is idempotent (running it twice on same DB is a no-op)', async () => {
    const { runMigrations: run } = await import('../database/migrations');
    const { getDb } = await import('../database/db');
    // Calling again must not throw.
    expect(() => run(getDb())).not.toThrow();
  });
});
