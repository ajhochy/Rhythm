import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { startTestServer } from './helpers/real_server';
import { UsersRepository } from '../repositories/users_repository';
import { SessionsRepository } from '../repositories/sessions_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';

// API-half contract tests for OCU-22 (#1063), OCU-23 (#1064),
// OCU-24 (#1065), OCU-25 (#1066).

const getVcs = vi.fn().mockResolvedValue({ branch: 'main', defaultBranch: 'main' });
const getVcsStatus = vi.fn().mockResolvedValue([{ path: 'a.ts', status: 'modified' }]);
const getVcsDiff = vi.fn().mockResolvedValue([{ path: 'a.ts' }]);
const getVcsDiffRaw = vi.fn().mockResolvedValue('diff --git a/a.ts b/a.ts\n');
const sessionShell = vi.fn().mockResolvedValue({ info: { id: 'msg_1' }, parts: [] });
const sessionInit = vi.fn().mockResolvedValue(true);

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    isReady: true,
    statusMessage: 'ready',
    getVcs: (...a: unknown[]) => getVcs(...a),
    getVcsStatus: (...a: unknown[]) => getVcsStatus(...a),
    getVcsDiff: (...a: unknown[]) => getVcsDiff(...a),
    getVcsDiffRaw: (...a: unknown[]) => getVcsDiffRaw(...a),
    sessionShell: (...a: unknown[]) => sessionShell(...a),
    sessionInit: (...a: unknown[]) => sessionInit(...a),
  },
  opencodeSessionMap: new Map(),
}));

vi.mock('../services/opencode_stream_bridge', () => ({
  streamBridge: { streamSession: vi.fn(), stopStream: vi.fn(), clearErrorStatus: vi.fn(), dispose: vi.fn() },
}));

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

describe('OCU-22/23/24/25 API-half', () => {
  let baseUrl: string;
  let close: () => Promise<void>;
  let headers: Record<string, string>;
  let sessionId: string;

  beforeEach(async () => {
    setDb(makeDb());
    const user = new UsersRepository().create({ name: 'T', email: 't@e.com' });
    const s = await new SessionsRepository().createAsync(user.id);
    headers = { Authorization: `Bearer ${s.token}`, 'Content-Type': 'application/json' };
    const repo = new AgentSessionsRepository();
    const row = repo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/repo', name: 'S' } as never);
    sessionId = row.id;
    repo.setSdkSessionId(row.id, 'ses_abc');
    repo.updateFields(row.id, { providerId: 'anthropic', modelId: 'claude-x' });
    const { createApp } = await import('../app');
    ({ baseUrl, close } = await startTestServer(createApp()));
  });
  afterEach(async () => {
    await close();
    vi.clearAllMocks();
  });

  it('GET /vcs and /vcs/status proxy through', async () => {
    expect((await fetch(`${baseUrl}/agent-sessions/${sessionId}/vcs`, { headers })).status).toBe(200);
    expect(getVcs).toHaveBeenCalledWith('/repo');
    expect((await fetch(`${baseUrl}/agent-sessions/${sessionId}/vcs/status`, { headers })).status).toBe(200);
    expect(getVcsStatus).toHaveBeenCalledWith('/repo');
  });

  it('GET /vcs/diff passes the mode param', async () => {
    await fetch(`${baseUrl}/agent-sessions/${sessionId}/vcs/diff?mode=branch`, { headers });
    expect(getVcsDiff).toHaveBeenCalledWith('/repo', 'branch');
    await fetch(`${baseUrl}/agent-sessions/${sessionId}/vcs/diff`, { headers });
    expect(getVcsDiff).toHaveBeenCalledWith('/repo', 'git');
  });

  it('GET /vcs/diff/raw returns text/x-diff', async () => {
    const res = await fetch(`${baseUrl}/agent-sessions/${sessionId}/vcs/diff/raw`, { headers });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/x-diff');
    expect(await res.text()).toContain('diff --git');
  });

  it('POST /:id/shell wraps session.shell with the resolved agent', async () => {
    const res = await fetch(`${baseUrl}/agent-sessions/${sessionId}/shell`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ command: 'ls -la' }),
    });
    expect(res.status).toBe(200);
    expect(sessionShell).toHaveBeenCalledWith('ses_abc', 'ls -la', 'claude-code', '/repo');
  });

  it('POST /:id/shell without a command → 400', async () => {
    const res = await fetch(`${baseUrl}/agent-sessions/${sessionId}/shell`, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('POST /:id/init wraps session.init with the session model', async () => {
    const res = await fetch(`${baseUrl}/agent-sessions/${sessionId}/init`, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    expect(sessionInit).toHaveBeenCalledWith(
      'ses_abc',
      expect.objectContaining({ providerID: 'anthropic', modelID: 'claude-x' }),
      '/repo',
    );
  });
});
