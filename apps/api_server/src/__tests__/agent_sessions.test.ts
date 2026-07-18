import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'os';
import Database from 'better-sqlite3';
import { createApp } from '../app';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { startTestServer } from './helpers/real_server';
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
    listAuthedProviders: vi.fn().mockResolvedValue(['anthropic', 'openai']),
    statusMessage: 'Opencode SDK ready',
    createSession: vi.fn().mockResolvedValue({ id: 'sdk-session-1' }),
    setAuth: vi.fn().mockResolvedValue(true),
    prompt: vi.fn().mockResolvedValue({}),
    promptAsync: vi.fn().mockResolvedValue(true),
    subscribeToEvents: vi.fn().mockResolvedValue(null),
    ensureReady: vi.fn().mockImplementation(async () => _ready),
    // OPC-M1-1: typed wrapper replaces duck-typed diffSession probe
    getSessionDiff: vi.fn().mockResolvedValue([]),
    abortSession: vi.fn().mockResolvedValue(true),
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
    clearErrorStatus: vi.fn(),
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

    ({ baseUrl, close: closeServer } = await startTestServer(createApp()));
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

  // ── #858: UUID-keyed agent_configs must resolve to their engine name ───────

  it('#858: session-create for a UUID-keyed agent persists agentKind = ocAgent, not the config id', async () => {
    const configsRepo = new AgentConfigsRepository();
    const uuidId = '11111111-1111-4111-8111-111111111111';
    configsRepo.insert({
      id: uuidId,
      label: 'AI Trend Researcher',
      icon: '',
      isAgent: true,
      enabled: true,
      ocAgent: 'ai-trend-researcher',
      sessionSelectable: true,
    });

    const payload = {
      agentId: uuidId,
      cwd: os.homedir(),
      name: 'UUID Agent Session',
    };

    const res = await fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(201);
    const session = (await res.json()) as { agentKind: string };
    // The engine must receive/persist the resolved ENGINE NAME (ocAgent), not
    // the raw agent_configs UUID — the UUID is not a registered engine agent.
    expect(session.agentKind).toBe('ai-trend-researcher');
    expect(session.agentKind).not.toBe(uuidId);
  });

  it('#858: session-create falls back to the config id when ocAgent is empty', async () => {
    const configsRepo = new AgentConfigsRepository();
    const uuidId = '22222222-2222-4222-8222-222222222222';
    configsRepo.insert({
      id: uuidId,
      label: 'Never Synced Agent',
      icon: '',
      isAgent: true,
      enabled: true,
      // ocAgent intentionally omitted (null) — simulates a profile created
      // before agent_profile_sync has had a chance to backfill it.
      sessionSelectable: true,
    });

    const payload = {
      agentId: uuidId,
      cwd: os.homedir(),
      name: 'Never Synced Session',
    };

    const res = await fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(201);
    const session = (await res.json()) as { agentKind: string };
    expect(session.agentKind).toBe(uuidId);
  });

  it('#858 regression: slug-keyed agent (claude-code, ocAgent null) still persists its id unchanged', async () => {
    const payload = {
      agentId: 'claude-code',
      cwd: os.homedir(),
      name: 'Slug Agent Session',
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

  it('resumes a resumable session (legacy: no sdk_session_id) by creating a fresh SDK session, mapping it, and starting the bridge', async () => {
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

  it('#858: resume with a UUID-keyed agentId re-resolves the persisted agentKind to the engine name', async () => {
    const configsRepo = new AgentConfigsRepository();
    const uuidId = '33333333-3333-4333-8333-333333333333';
    configsRepo.insert({
      id: uuidId,
      label: 'Org Optimizer Discovery',
      icon: '',
      isAgent: true,
      enabled: true,
      ocAgent: 'org-optimizer-discovery',
      sessionSelectable: true,
    });

    const sessionsRepoLocal = new AgentSessionsRepository();
    const inserted = sessionsRepoLocal.insert({
      // Simulates a pre-fix row that stored the raw UUID as agentKind.
      agentKind: uuidId as unknown as import('../models/agent_session').AgentKind,
      taskId: null,
      taskTitle: null,
      cwd: os.homedir(),
      name: 'Resumable UUID Session',
    });
    sessionsRepoLocal.updateToken(inserted.id, 'sdk-prior-token');
    sessionsRepoLocal.updateStatus(inserted.id, 'resumable');

    const { opencodeClient } = await import('../services/opencode_engine');
    const mockClient = opencodeClient as unknown as { createSession: ReturnType<typeof vi.fn> };
    mockClient.createSession.mockResolvedValueOnce({ id: 'sdk-resumed-uuid-session' });

    const res = await fetch(`${baseUrl}/agent-sessions/${inserted.id}/resume`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ agentId: uuidId }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { agentKind: string };
    expect(body.agentKind).toBe('org-optimizer-discovery');
    expect(body.agentKind).not.toBe(uuidId);
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
      // Explicit null so M1-3 cwd-prefix auto-assign does not pick up Filter.
      body: JSON.stringify({ agentId: 'claude-code', cwd: os.homedir(), name: 'Out', projectId: null }),
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
      // Explicit null bypasses cwd-prefix auto-assign.
      body: JSON.stringify({ agentId: 'claude-code', cwd: os.homedir(), name: 'UnassignedY', projectId: null }),
    });

    const res = await fetch(`${baseUrl}/agent-sessions?projectId=null`, { headers: authHeaders });
    const body = (await res.json()) as { sessions: Array<{ name: string; projectId: string | null }> };
    expect(body.sessions.every((s) => s.projectId === null)).toBe(true);
    expect(body.sessions.find((s) => s.name === 'UnassignedY')).toBeDefined();
    expect(body.sessions.find((s) => s.name === 'AssignedX')).toBeUndefined();
  });

  // ── USO A1 (#1024) / B1 (#1028): GET /agent-sessions?scope= ──────────────
  it('scope param slices the session list (chats default, scheduled, self_improvement, safe fallback)', async () => {
    const { getDb } = await import('../database/db');
    getDb()
      .prepare(`INSERT INTO agent_scheduled_tasks (id, name, prompt) VALUES (?, ?, ?)`)
      .run('sched-scope', 'Scope Task', 'do it');
    const repo = new AgentSessionsRepository();
    const chat = repo.insert({ agentKind: 'claude-code', taskId: null, cwd: os.homedir(), name: 'ChatRow' });
    const scheduled = repo.insert({
      agentKind: 'claude-code', taskId: null, cwd: os.homedir(), name: 'ScheduledRow',
      scheduledTaskId: 'sched-scope', isSystem: true,
    });
    const selfImprove = repo.insert({
      agentKind: 'claude-code', taskId: null, cwd: os.homedir(), name: 'SelfImproveRow',
      isSystem: true, category: 'self_improvement',
    });

    const ids = async (qs: string): Promise<string[]> => {
      const res = await fetch(`${baseUrl}/agent-sessions${qs}`, { headers: authHeaders });
      const body = (await res.json()) as { sessions: Array<{ id: string }> };
      return body.sessions.map((s) => s.id);
    };

    // No scope === scope=chats: interactive chat only.
    expect(await ids('')).toEqual([chat.id]);
    expect(await ids('?scope=chats')).toEqual([chat.id]);
    // scope=scheduled surfaces the scheduled row that chats hides.
    expect(await ids('?scope=scheduled')).toEqual([scheduled.id]);
    // scope=self_improvement surfaces only the self-improvement row.
    expect(await ids('?scope=self_improvement')).toEqual([selfImprove.id]);
    // Unknown scope falls back safely to chats.
    expect(await ids('?scope=bogus')).toEqual([chat.id]);
  });

  it('projects migration is idempotent (running it twice on same DB is a no-op)', async () => {
    const { runMigrations: run } = await import('../database/migrations');
    const { getDb } = await import('../database/db');
    // Calling again must not throw.
    expect(() => run(getDb())).not.toThrow();
  });

  // ── M1-3 #588: auto-assign project on session create by cwd prefix ───────

  it('auto-assigns project when omitted and cwd exactly matches a project', async () => {
    const projectId = await createProject('Exact', '/Users/x/Documents/Rhythm');
    const res = await fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        agentId: 'claude-code',
        cwd: '/Users/x/Documents/Rhythm',
        name: 'Exact',
      }),
    });
    const session = (await res.json()) as { projectId: string | null };
    expect(session.projectId).toBe(projectId);
  });

  it('auto-assigns project when cwd is a prefix-deeper path', async () => {
    const projectId = await createProject('Prefix', '/Users/x/Documents/Rhythm');
    const res = await fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        agentId: 'claude-code',
        cwd: '/Users/x/Documents/Rhythm/apps/api_server',
        name: 'Deep',
      }),
    });
    const session = (await res.json()) as { projectId: string | null };
    expect(session.projectId).toBe(projectId);
  });

  it('returns projectId=null when no project matches', async () => {
    await createProject('Unrelated', '/Users/x/Documents/Rhythm');
    const res = await fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        agentId: 'claude-code',
        cwd: '/Users/x/elsewhere',
        name: 'NoMatch',
      }),
    });
    const session = (await res.json()) as { projectId: string | null };
    expect(session.projectId).toBeNull();
  });

  it('explicit projectId=null is not overridden by auto-assign', async () => {
    await createProject('Wouldmatch', '/Users/x/Documents/Rhythm');
    const res = await fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        agentId: 'claude-code',
        cwd: '/Users/x/Documents/Rhythm/apps',
        name: 'IntentionalNull',
        projectId: null,
      }),
    });
    const session = (await res.json()) as { projectId: string | null };
    expect(session.projectId).toBeNull();
  });

  it('longest cwd prefix wins when multiple projects match', async () => {
    await createProject('Outer', '/Users/x/A');
    const innerId = await createProject('Inner', '/Users/x/A/sub');
    const res = await fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        agentId: 'claude-code',
        cwd: '/Users/x/A/sub/inner',
        name: 'Nested',
      }),
    });
    const session = (await res.json()) as { projectId: string | null };
    expect(session.projectId).toBe(innerId);
  });

  it('skips archived projects in cwd-prefix lookup', async () => {
    const archivedId = await createProject('Archived', '/Users/x/archived');
    await fetch(`${baseUrl}/projects/${archivedId}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ archivedAt: new Date().toISOString() }),
    });
    const res = await fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        agentId: 'claude-code',
        cwd: '/Users/x/archived/deeper',
        name: 'SkipArchived',
      }),
    });
    const session = (await res.json()) as { projectId: string | null };
    expect(session.projectId).toBeNull();
  });

  // ── M2-1 #593: PATCH /agent-sessions/:id ──────────────────────────────────

  async function createSession(): Promise<string> {
    const res = await fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        agentId: 'claude-code',
        cwd: os.homedir(),
        name: 'For PATCH',
        projectId: null,
      }),
    });
    const s = (await res.json()) as { id: string };
    return s.id;
  }

  it('PATCH /agent-sessions/:id updates name', async () => {
    const id = await createSession();
    const res = await fetch(`${baseUrl}/agent-sessions/${id}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ name: 'Renamed' }),
    });
    expect(res.status).toBe(200);
    const updated = (await res.json()) as { name: string };
    expect(updated.name).toBe('Renamed');
  });

  it('PATCH /agent-sessions/:id sets providerId+modelId when provider is authed', async () => {
    const id = await createSession();
    const res = await fetch(`${baseUrl}/agent-sessions/${id}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ providerId: 'anthropic', modelId: 'claude-sonnet-4-6' }),
    });
    expect(res.status).toBe(200);
    const updated = (await res.json()) as { providerId: string | null; modelId: string | null };
    expect(updated.providerId).toBe('anthropic');
    expect(updated.modelId).toBe('claude-sonnet-4-6');
  });

  it('PATCH /agent-sessions/:id rejects an unknown provider', async () => {
    const id = await createSession();
    const res = await fetch(`${baseUrl}/agent-sessions/${id}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ providerId: 'not-real-provider', modelId: 'foo' }),
    });
    expect(res.status).toBe(400);
  });

  it('PATCH /agent-sessions/:id with providerId=null clears the override', async () => {
    const id = await createSession();
    await fetch(`${baseUrl}/agent-sessions/${id}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ providerId: 'anthropic', modelId: 'claude-sonnet-4-6' }),
    });
    const res = await fetch(`${baseUrl}/agent-sessions/${id}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ providerId: null, modelId: null }),
    });
    const cleared = (await res.json()) as { providerId: string | null };
    expect(cleared.providerId).toBeNull();
  });

  // ── M2-2 #594: resolveModelForSessionTurn precedence ─────────────────────

  it('resolveModelForSessionTurn: per-turn override beats session default', async () => {
    const { resolveModelForSessionTurn } = await import('../services/agent_model_resolver');
    const r = await resolveModelForSessionTurn({
      agentId: 'claude-code',
      sessionProviderId: 'anthropic',
      sessionModelId: 'claude-sonnet-4-6',
      perTurnOverride: { providerId: 'openrouter', modelId: 'meta/llama' },
    });
    expect(r).toEqual({ providerID: 'openrouter', modelID: 'meta/llama' });
  });

  it('resolveModelForSessionTurn: session default beats agent fallback', async () => {
    const { resolveModelForSessionTurn } = await import('../services/agent_model_resolver');
    const r = await resolveModelForSessionTurn({
      agentId: 'claude-code',
      sessionProviderId: 'openrouter',
      sessionModelId: 'anthropic/claude-sonnet-4.6',
      perTurnOverride: null,
    });
    expect(r).toEqual({ providerID: 'openrouter', modelID: 'anthropic/claude-sonnet-4.6' });
  });

  it('resolveModelForSessionTurn: falls back to agent fallback when nothing set', async () => {
    const { resolveModelForSessionTurn } = await import('../services/agent_model_resolver');
    const r = await resolveModelForSessionTurn({
      agentId: 'claude-code',
      sessionProviderId: null,
      sessionModelId: null,
      perTurnOverride: null,
    });
    expect(r).toBeDefined();
    // The fallback list's first authed entry; in tests listAuthedProviders
    // returns anthropic/openai (from the mock).
    expect(r?.providerID).toBe('anthropic');
  });

  // ── M2-4 #596: POST /agent-sessions/:id/cancel ───────────────────────────

  it('POST /agent-sessions/:id/cancel aborts via the SDK', async () => {
    // create() registers an SDK mapping via the mocked opencodeClient.createSession
    // so the cancel endpoint can find it.
    const createRes = await fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        agentId: 'claude-code',
        cwd: os.homedir(),
        name: 'For Cancel',
      }),
    });
    const session = (await createRes.json()) as { id: string };

    // Add an abortSession mock to the engine.
    const { opencodeClient } = await import('../services/opencode_engine');
    (opencodeClient as unknown as { abortSession: (s: string) => Promise<boolean> })
      .abortSession = vi.fn().mockResolvedValue(true);

    const res = await fetch(`${baseUrl}/agent-sessions/${session.id}/cancel`, {
      method: 'POST',
      headers: authHeaders,
    });
    expect(res.status).toBe(204);
  });

  // ── M3-4 #601: GET /agent-sessions/:id/diff ───────────────────────────

  it('GET /agent-sessions/:id/diff returns [] when no SDK mapping', async () => {
    const sessionsRepoLocal = new AgentSessionsRepository();
    const inserted = sessionsRepoLocal.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: os.homedir(),
      name: 'NoMap',
    });
    const res = await fetch(`${baseUrl}/agent-sessions/${inserted.id}/diff`, {
      headers: authHeaders,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it('GET /agent-sessions/:id/diff calls SDK getSessionDiff when available', async () => {
    const createRes = await fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        agentId: 'claude-code',
        cwd: os.homedir(),
        name: 'WithDiff',
      }),
    });
    const session = (await createRes.json()) as { id: string };
    const { opencodeClient } = await import('../services/opencode_engine');
    // OPC-M1-1: mock the typed wrapper, not the old duck-typed diffSession probe.
    vi.mocked(
      (opencodeClient as unknown as { getSessionDiff: ReturnType<typeof vi.fn> }).getSessionDiff,
    ).mockResolvedValueOnce([
      { file: 'a.txt', before: 'old', after: 'new', additions: 1, deletions: 0 },
    ]);
    const res = await fetch(`${baseUrl}/agent-sessions/${session.id}/diff`, {
      headers: authHeaders,
    });
    const body = (await res.json()) as Array<{ file: string }>;
    expect(body).toHaveLength(1);
    expect(body[0].file).toBe('a.txt');
  });

  it('POST /agent-sessions/:id/cancel returns 400 when no SDK mapping exists', async () => {
    const sessionsRepoLocal = new AgentSessionsRepository();
    const inserted = sessionsRepoLocal.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: os.homedir(),
      name: 'Stale',
    });
    const res = await fetch(`${baseUrl}/agent-sessions/${inserted.id}/cancel`, {
      method: 'POST',
      headers: authHeaders,
    });
    expect(res.status).toBe(400);
  });

  // ── Issue #601: archive / soft-delete ─────────────────────────────────────

  it('PATCH { archived: true } sets archivedAt and the row is excluded from default GET', async () => {
    // Create a session via REST so the SDK mapping is populated (required by create).
    const createRes = await fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ agentId: 'claude-code', cwd: os.homedir(), name: 'ToArchive', projectId: null }),
    });
    expect(createRes.status).toBe(201);
    const { id } = (await createRes.json()) as { id: string };

    // Archive it.
    const archiveRes = await fetch(`${baseUrl}/agent-sessions/${id}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ archived: true }),
    });
    expect(archiveRes.status).toBe(200);
    const archived = (await archiveRes.json()) as { id: string; archivedAt: string | null };
    expect(archived.archivedAt).not.toBeNull();

    // Default list must NOT include the archived row.
    const listRes = await fetch(`${baseUrl}/agent-sessions`, { headers: authHeaders });
    const listBody = (await listRes.json()) as { sessions: Array<{ id: string }> };
    expect(listBody.sessions.find((s) => s.id === id)).toBeUndefined();
  });

  it('GET ?archivedOnly=true returns only archived rows', async () => {
    const createRes = await fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ agentId: 'claude-code', cwd: os.homedir(), name: 'ArchivedOnly', projectId: null }),
    });
    const { id } = (await createRes.json()) as { id: string };

    await fetch(`${baseUrl}/agent-sessions/${id}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ archived: true }),
    });

    // Also create a non-archived session.
    await fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ agentId: 'claude-code', cwd: os.homedir(), name: 'NotArchived', projectId: null }),
    });

    const res = await fetch(`${baseUrl}/agent-sessions?archivedOnly=true`, { headers: authHeaders });
    const body = (await res.json()) as { sessions: Array<{ id: string; archivedAt: string | null }> };
    expect(body.sessions.every((s) => s.archivedAt !== null)).toBe(true);
    expect(body.sessions.find((s) => s.id === id)).toBeDefined();
  });

  it('GET ?includeArchived=true includes both archived and non-archived rows', async () => {
    const r1 = await fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ agentId: 'claude-code', cwd: os.homedir(), name: 'IncludedArchive', projectId: null }),
    });
    const { id: archivedId } = (await r1.json()) as { id: string };
    await fetch(`${baseUrl}/agent-sessions/${archivedId}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ archived: true }),
    });
    const r2 = await fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ agentId: 'claude-code', cwd: os.homedir(), name: 'IncludedActive', projectId: null }),
    });
    const { id: activeId } = (await r2.json()) as { id: string };

    const res = await fetch(`${baseUrl}/agent-sessions?includeArchived=true`, { headers: authHeaders });
    const body = (await res.json()) as { sessions: Array<{ id: string }> };
    expect(body.sessions.find((s) => s.id === archivedId)).toBeDefined();
    expect(body.sessions.find((s) => s.id === activeId)).toBeDefined();
  });

  it('PATCH { archived: false } clears archivedAt and row reappears in default GET', async () => {
    const createRes = await fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ agentId: 'claude-code', cwd: os.homedir(), name: 'UnarchiveMe', projectId: null }),
    });
    const { id } = (await createRes.json()) as { id: string };

    // Archive then unarchive.
    await fetch(`${baseUrl}/agent-sessions/${id}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ archived: true }),
    });
    const unarchiveRes = await fetch(`${baseUrl}/agent-sessions/${id}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ archived: false }),
    });
    expect(unarchiveRes.status).toBe(200);
    const unarchived = (await unarchiveRes.json()) as { archivedAt: string | null };
    expect(unarchived.archivedAt).toBeNull();

    // Must reappear in default list.
    const listRes = await fetch(`${baseUrl}/agent-sessions`, { headers: authHeaders });
    const listBody = (await listRes.json()) as { sessions: Array<{ id: string }> };
    expect(listBody.sessions.find((s) => s.id === id)).toBeDefined();
  });

  it('archived_at migration is idempotent (running migrations twice is a no-op)', async () => {
    const { runMigrations: run } = await import('../database/migrations');
    const { getDb } = await import('../database/db');
    expect(() => run(getDb())).not.toThrow();
  });

  // ── PR #619 acceptance: SESSIONS ACTUALLY LAUNCH when taskId is missing locally
  // Contract: docs/ai/contracts/pr-619.json
  // These tests assert the full launch path, not just "row inserted":
  //   - 201 with the expected taskId/taskTitle reconciliation
  //   - opencodeClient.createSession invoked (SDK session created)
  //   - opencodeSessionMap populated (stream-bridge can route prompts → SDK)
  //   - opencodeClient.promptAsync invoked (initial prompt actually dispatched)

  it('launches a session end-to-end when taskId is not present in the local tasks table (PR #619 acceptance)', async () => {
    // foreign_keys = ON is set in makeDb(); this taskId does not exist in tasks.
    const bogusTaskId = 'definitely-not-in-local-db';
    const taskTitle = 'Synthetic task from production';
    const sessionName = 'FK launch test';
    const cwd = os.homedir();

    const { opencodeClient, opencodeSessionMap } = await import('../services/opencode_engine');
    const mock = opencodeClient as unknown as {
      createSession: ReturnType<typeof vi.fn>;
      promptAsync: ReturnType<typeof vi.fn>;
    };
    mock.createSession.mockResolvedValueOnce({ id: 'sdk-launch-no-fk' });

    const res = await fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        agentId: 'claude-code',
        cwd,
        name: sessionName,
        taskId: bogusTaskId,
        taskTitle,
      }),
    });

    expect(res.status).toBe(201);
    const session = (await res.json()) as {
      id: string;
      taskId: string | null;
      taskTitle: string | null;
      status: string;
    };
    expect(session.taskId).toBeNull();
    expect(session.taskTitle).toBe(taskTitle);
    expect(session.status).toBe('starting');

    // C1: createSession now accepts an optional third arg (mcpRoleConfig).
    // When no mcpRole is provided the arg is undefined.
    expect(mock.createSession).toHaveBeenCalledWith(sessionName, cwd, undefined);
    expect(opencodeSessionMap.get(session.id)).toBe('sdk-launch-no-fk');
    // Issue #653: server no longer fabricates an "I need help with: <title>"
    // initial prompt. The client owns first-turn content via composer prefill.
    expect(mock.promptAsync).not.toHaveBeenCalled();
  });

  it('launches a session end-to-end when taskId IS present in the local tasks table (happy path)', async () => {
    const { getDb } = await import('../database/db');
    const db = getDb();
    const taskId = 'local-task-abc123';
    db.prepare(
      `INSERT INTO tasks (id, title, status, created_at, updated_at)
       VALUES (?, 'Local Task', 'pending', datetime('now'), datetime('now'))`,
    ).run(taskId);

    const sessionName = 'Real task launch';
    const cwd = os.homedir();
    const { opencodeClient, opencodeSessionMap } = await import('../services/opencode_engine');
    const mock = opencodeClient as unknown as {
      createSession: ReturnType<typeof vi.fn>;
      promptAsync: ReturnType<typeof vi.fn>;
    };
    mock.createSession.mockResolvedValueOnce({ id: 'sdk-launch-with-fk' });

    const res = await fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        agentId: 'claude-code',
        cwd,
        name: sessionName,
        taskId,
        taskTitle: 'Local Task',
      }),
    });

    expect(res.status).toBe(201);
    const session = (await res.json()) as {
      id: string;
      taskId: string | null;
      taskTitle: string | null;
      status: string;
    };
    expect(session.taskId).toBe(taskId);
    expect(session.taskTitle).toBe('Local Task');
    expect(session.status).toBe('starting');
    // C1: createSession now accepts an optional third arg (mcpRoleConfig).
    // When no mcpRole is provided the arg is undefined.
    expect(mock.createSession).toHaveBeenCalledWith(sessionName, cwd, undefined);
    expect(opencodeSessionMap.get(session.id)).toBe('sdk-launch-with-fk');
    // Issue #653: no auto-initial-prompt; client owns first-turn content.
    expect(mock.promptAsync).not.toHaveBeenCalled();
  });
});
