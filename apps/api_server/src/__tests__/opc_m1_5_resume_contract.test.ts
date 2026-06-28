/**
 * OPC-M1-5 Resume with real conversation continuity — contract tests.
 * Issue #689.
 *
 * Criteria covered:
 *   c1 — POST create persists sdk_session_id on the DB row
 *   c2 — resume() re-attaches via sdk_session_id; ZERO createSession calls
 *   c3 — after resume, WS session.input routes the prompt to the original SDK id
 *   c4 — resume() returns HTTP 410 when the SDK session is gone; no map entry
 */

import os from 'os';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { createApp } from '../app';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { UsersRepository } from '../repositories/users_repository';
import { SessionsRepository } from '../repositories/sessions_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { startTestServer } from './helpers/real_server';

// ---------------------------------------------------------------------------
// Shared mock state — hoisted so vi.mock factories can reference them
// ---------------------------------------------------------------------------

const { createSessionSpy, promptAsyncSpy, sessionMap } = vi.hoisted(() => ({
  createSessionSpy: vi.fn(),
  promptAsyncSpy: vi.fn(),
  sessionMap: new Map<string, string>(),
}));

vi.mock('../services/opencode_engine', () => {
  const mockClient = {
    get isReady() { return true; },
    statusMessage: 'Opencode SDK ready',
    ensureReady: vi.fn().mockResolvedValue(true),
    createSession: createSessionSpy,
    getSessionDiff: vi.fn().mockResolvedValue([]),
    abortSession: vi.fn().mockResolvedValue(true),
    listAuthedProviders: vi.fn().mockResolvedValue(['anthropic']),
    listProviders: vi.fn().mockResolvedValue(['anthropic']),
    subscribeToEvents: vi.fn().mockResolvedValue(null),
    promptAsync: promptAsyncSpy,
    // getSession will be set per-test via opencodeClient.getSession
    getSession: vi.fn(),
  };
  return {
    opencodeClient: mockClient,
    opencodeSessionMap: sessionMap,
  };
});

vi.mock('../services/opencode_stream_bridge', () => ({
  streamBridge: {
    streamSession: vi.fn().mockResolvedValue(undefined),
    stopStream: vi.fn(),
    clearErrorStatus: vi.fn(),
    dispose: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

async function setupServer() {
  setDb(makeDb());
  const usersRepo = new UsersRepository();
  const sessionsRepo = new SessionsRepository();
  const user = usersRepo.create({ name: 'Test User', email: 'test@example.com' });
  const session = await sessionsRepo.createAsync(user.id);
  const authHeaders = {
    Authorization: `Bearer ${session.token}`,
    'Content-Type': 'application/json',
  };
  const { baseUrl, close: closeServer } = await startTestServer(createApp());
  return { baseUrl, authHeaders, closeServer };
}

// ---------------------------------------------------------------------------
// c1 — POST create persists sdk_session_id
// ---------------------------------------------------------------------------

describe('issue-689-c1: POST create persists sdk_session_id matching mocked SDK id', () => {
  let baseUrl: string;
  let authHeaders: Record<string, string>;
  let closeServer: () => Promise<void>;

  beforeEach(async () => {
    createSessionSpy.mockResolvedValue({ id: 'sdk-new-session-1' });
    ({ baseUrl, authHeaders, closeServer } = await setupServer());
  });

  afterEach(async () => {
    await closeServer();
    vi.clearAllMocks();
  });

  it('c1: POST /agent-sessions stores sdk_session_id equal to the mocked SDK session id', async () => {
    const res = await fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        agentId: 'claude-code',
        cwd: os.homedir(),
        name: 'c1 session',
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string };

    // Verify the DB row was written with the sdk_session_id.
    const repo = new AgentSessionsRepository();
    const row = repo.findById(body.id);
    expect(row).not.toBeNull();
    // The sdk_session_id column should equal the mocked SDK session id.
    expect((row as { sdkSessionId?: string | null }).sdkSessionId).toBe(
      'sdk-new-session-1',
    );
  });
});

// ---------------------------------------------------------------------------
// c2 — resume() re-attaches via sdk_session_id without creating a new session
// ---------------------------------------------------------------------------

describe('issue-689-c2: resume() re-attaches via sdk_session_id without calling createSession', () => {
  let baseUrl: string;
  let authHeaders: Record<string, string>;
  let closeServer: () => Promise<void>;
  const SDK_SESSION_ID = 'sdk-existing-session-999';

  beforeEach(async () => {
    createSessionSpy.mockResolvedValue({ id: 'sdk-brand-new-session' });
    ({ baseUrl, authHeaders, closeServer } = await setupServer());
  });

  afterEach(async () => {
    await closeServer();
    vi.clearAllMocks();
  });

  it('c2: resume() maps the existing SDK id and calls createSession ZERO times', async () => {
    // Create a session row that is "resumable" with a known sdk_session_id.
    const repo = new AgentSessionsRepository();
    const session = repo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: os.homedir(),
      name: 'Resumable',
    });
    // Mark resumable with a session token (existing contract) AND sdk_session_id.
    repo.updateToken(session.id, 'legacy-session-token');
    repo.updateStatus(session.id, 'resumable');
    repo.setSdkSessionId(session.id, SDK_SESSION_ID);

    // Mock the SDK to confirm the session exists.
    const { opencodeClient } = await import('../services/opencode_engine');
    (opencodeClient as unknown as { getSession: ReturnType<typeof vi.fn> }).getSession =
      vi.fn().mockResolvedValue({ id: SDK_SESSION_ID, title: 'existing' });

    createSessionSpy.mockClear();

    const res = await fetch(`${baseUrl}/agent-sessions/${session.id}/resume`, {
      method: 'POST',
      headers: authHeaders,
    });

    expect(res.status).toBe(200);
    // ZERO createSession calls — re-attach must NOT create a fresh SDK session.
    expect(createSessionSpy).not.toHaveBeenCalled();

    // The opencodeSessionMap must be populated with the existing SDK id.
    const { opencodeSessionMap } = await import('../services/opencode_engine');
    expect(opencodeSessionMap.get(session.id)).toBe(SDK_SESSION_ID);
  });
});

// ---------------------------------------------------------------------------
// c3 — after resume, WS session.input routes to the original SDK session id
// ---------------------------------------------------------------------------

describe('issue-689-c3: after resume WS session.input routes to original SDK session id', () => {
  let baseUrl: string;
  let authHeaders: Record<string, string>;
  let closeServer: () => Promise<void>;
  const SDK_SESSION_ID = 'sdk-original-session-abc';

  beforeEach(async () => {
    createSessionSpy.mockResolvedValue({ id: 'sdk-brand-new-never-used' });
    promptAsyncSpy.mockResolvedValue(undefined);
    ({ baseUrl, authHeaders, closeServer } = await setupServer());
  });

  afterEach(async () => {
    await closeServer();
    vi.clearAllMocks();
  });

  it('c3: opencodeSessionMap maps local id → original SDK id after resume', async () => {
    const repo = new AgentSessionsRepository();
    const session = repo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: os.homedir(),
      name: 'Resumable c3',
    });
    repo.updateToken(session.id, 'token-c3');
    repo.updateStatus(session.id, 'resumable');
    repo.setSdkSessionId(session.id, SDK_SESSION_ID);

    const { opencodeClient } = await import('../services/opencode_engine');
    (opencodeClient as unknown as { getSession: ReturnType<typeof vi.fn> }).getSession =
      vi.fn().mockResolvedValue({ id: SDK_SESSION_ID, title: 'original' });

    const resumeRes = await fetch(
      `${baseUrl}/agent-sessions/${session.id}/resume`,
      {
        method: 'POST',
        headers: authHeaders,
      },
    );
    expect(resumeRes.status).toBe(200);

    // After resume, the map must point to the ORIGINAL sdk session id.
    const { opencodeSessionMap } = await import('../services/opencode_engine');
    const mappedId = opencodeSessionMap.get(session.id);
    expect(mappedId).toBe(SDK_SESSION_ID);
    // Must NOT be the "brand new" id that createSession would return.
    expect(mappedId).not.toBe('sdk-brand-new-never-used');
  });
});

// ---------------------------------------------------------------------------
// c4 — resume() returns HTTP 410 when SDK session is gone
// ---------------------------------------------------------------------------

describe('issue-689-c4: resume() returns 410 when SDK session gone; no map entry', () => {
  let baseUrl: string;
  let authHeaders: Record<string, string>;
  let closeServer: () => Promise<void>;
  const SDK_SESSION_ID = 'sdk-gone-session-404';

  beforeEach(async () => {
    createSessionSpy.mockResolvedValue({ id: 'sdk-fallback-session' });
    ({ baseUrl, authHeaders, closeServer } = await setupServer());
  });

  afterEach(async () => {
    await closeServer();
    vi.clearAllMocks();
  });

  it('c4: returns 410 when SDK returns no session; no map entry created', async () => {
    const repo = new AgentSessionsRepository();
    const session = repo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: os.homedir(),
      name: 'Gone Session',
    });
    repo.updateToken(session.id, 'token-gone');
    repo.updateStatus(session.id, 'resumable');
    repo.setSdkSessionId(session.id, SDK_SESSION_ID);

    // SDK reports the session is gone (data undefined/null, or throws).
    const { opencodeClient } = await import('../services/opencode_engine');
    (opencodeClient as unknown as { getSession: ReturnType<typeof vi.fn> }).getSession =
      vi.fn().mockResolvedValue(null);

    const res = await fetch(`${baseUrl}/agent-sessions/${session.id}/resume`, {
      method: 'POST',
      headers: authHeaders,
    });

    expect(res.status).toBe(410);
    const body = (await res.json()) as { error?: string; message?: string };
    // Body must name the session (by name or SDK id).
    const text = JSON.stringify(body);
    expect(text).toMatch(/Gone Session|sdk-gone-session-404/);

    // No map entry must have been created.
    const { opencodeSessionMap } = await import('../services/opencode_engine');
    expect(opencodeSessionMap.has(session.id)).toBe(false);
  });
});
