import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'os';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { startTestServer } from './helpers/real_server';
import { UsersRepository } from '../repositories/users_repository';
import { SessionsRepository } from '../repositories/sessions_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';

// OCU-17 (#1058) — session create with isolateWorktree option.

const createWorktree = vi.fn();
const removeWorktree = vi.fn().mockResolvedValue(true);
const resetWorktree = vi.fn().mockResolvedValue(true);

vi.mock('../services/opencode_engine', () => {
  const mockClient = {
    isReady: true,
    statusMessage: 'Opencode SDK ready',
    createSession: vi.fn().mockResolvedValue({ id: 'sdk-session-1' }),
    ensureReady: vi.fn().mockResolvedValue(true),
    getSessionDiff: vi.fn().mockResolvedValue([]),
    abortSession: vi.fn().mockResolvedValue(true),
    deleteSession: vi.fn().mockResolvedValue(true),
    createWorktree: (...a: unknown[]) => createWorktree(...a),
    removeWorktree: (...a: unknown[]) => removeWorktree(...a),
    resetWorktree: (...a: unknown[]) => resetWorktree(...a),
  };
  return { opencodeClient: mockClient, opencodeSessionMap: new Map<string, string>() };
});

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

describe('OCU-17 (#1058) isolateWorktree', () => {
  let baseUrl: string;
  let close: () => Promise<void>;
  let authHeaders: Record<string, string>;
  let repo: AgentSessionsRepository;

  beforeEach(async () => {
    setDb(makeDb());
    const user = new UsersRepository().create({ name: 'T', email: 't@e.com' });
    const session = await new SessionsRepository().createAsync(user.id);
    authHeaders = { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' };
    repo = new AgentSessionsRepository();
    const { createApp } = await import('../app');
    ({ baseUrl, close } = await startTestServer(createApp()));
    createWorktree.mockReset();
    removeWorktree.mockClear();
    resetWorktree.mockClear();
  });
  afterEach(async () => {
    await close();
    vi.clearAllMocks();
  });

  it('isolateWorktree=true creates a worktree, uses its dir as cwd, and persists metadata', async () => {
    createWorktree.mockResolvedValue({
      name: 'wt-a',
      branch: 'agent/wt-a',
      directory: '/repo/.worktrees/wt-a',
    });
    const res = await fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ agentId: 'claude-code', cwd: '/repo', name: 'S', isolateWorktree: true }),
    });
    expect(res.status).toBe(201);
    expect(createWorktree).toHaveBeenCalledWith('/repo', { name: undefined });
    const body = (await res.json()) as {
      cwd: string;
      worktreeName: string;
      worktreePath: string;
      worktreeBranch: string;
    };
    expect(body.cwd).toBe('/repo/.worktrees/wt-a');
    expect(body.worktreeName).toBe('wt-a');
    expect(body.worktreePath).toBe('/repo/.worktrees/wt-a');
    expect(body.worktreeBranch).toBe('agent/wt-a');
  });

  it('without the flag behaves exactly as today (no worktree call, null metadata)', async () => {
    const res = await fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ agentId: 'claude-code', cwd: os.homedir(), name: 'S' }),
    });
    expect(res.status).toBe(201);
    expect(createWorktree).not.toHaveBeenCalled();
    const body = (await res.json()) as { worktreeName: string | null; cwd: string };
    expect(body.worktreeName).toBeNull();
    expect(body.cwd).toBe(os.homedir());
  });

  it('DELETE .../hard?removeWorktree=true cleans up the worktree', async () => {
    createWorktree.mockResolvedValue({ name: 'wt-b', branch: 'b', directory: '/repo/.wt/wt-b' });
    const createRes = await fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ agentId: 'claude-code', cwd: '/repo', name: 'S', isolateWorktree: true }),
    });
    const { id } = (await createRes.json()) as { id: string };

    const delRes = await fetch(`${baseUrl}/agent-sessions/${id}/hard?removeWorktree=true`, {
      method: 'DELETE',
      headers: authHeaders,
    });
    expect(delRes.status).toBe(204);
    expect(removeWorktree).toHaveBeenCalledWith('/repo/.wt/wt-b', '/repo/.wt/wt-b');
  });

  it('DELETE .../hard without the flag keeps the worktree (default)', async () => {
    createWorktree.mockResolvedValue({ name: 'wt-c', branch: 'c', directory: '/repo/.wt/wt-c' });
    const createRes = await fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ agentId: 'claude-code', cwd: '/repo', name: 'S', isolateWorktree: true }),
    });
    const { id } = (await createRes.json()) as { id: string };

    const delRes = await fetch(`${baseUrl}/agent-sessions/${id}/hard`, {
      method: 'DELETE',
      headers: authHeaders,
    });
    expect(delRes.status).toBe(204);
    expect(removeWorktree).not.toHaveBeenCalled();
  });

  // ── OCU-18 (#1059) — Changes-tab worktree actions ─────────────────────────

  it('POST .../worktree/reset resets an isolated session\'s worktree', async () => {
    createWorktree.mockResolvedValue({ name: 'wt-d', branch: 'd', directory: '/repo/.wt/wt-d' });
    const createRes = await fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ agentId: 'claude-code', cwd: '/repo', name: 'S', isolateWorktree: true }),
    });
    const { id } = (await createRes.json()) as { id: string };

    const res = await fetch(`${baseUrl}/agent-sessions/${id}/worktree/reset`, {
      method: 'POST',
      headers: authHeaders,
    });
    expect(res.status).toBe(200);
    expect(resetWorktree).toHaveBeenCalledWith('/repo/.wt/wt-d', '/repo/.wt/wt-d');
    // Reset doesn't clear worktree metadata — the session is still isolated.
    expect(repo.findById(id)?.worktreePath).toBe('/repo/.wt/wt-d');
  });

  it('POST .../worktree/reset on a non-isolated session → 400', async () => {
    const createRes = await fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ agentId: 'claude-code', cwd: os.homedir(), name: 'S' }),
    });
    const { id } = (await createRes.json()) as { id: string };

    const res = await fetch(`${baseUrl}/agent-sessions/${id}/worktree/reset`, {
      method: 'POST',
      headers: authHeaders,
    });
    expect(res.status).toBe(400);
    expect(resetWorktree).not.toHaveBeenCalled();
  });

  it('POST .../worktree/remove removes the worktree and clears session metadata (session stays)', async () => {
    createWorktree.mockResolvedValue({ name: 'wt-e', branch: 'e', directory: '/repo/.wt/wt-e' });
    const createRes = await fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ agentId: 'claude-code', cwd: '/repo', name: 'S', isolateWorktree: true }),
    });
    const { id } = (await createRes.json()) as { id: string };

    const res = await fetch(`${baseUrl}/agent-sessions/${id}/worktree/remove`, {
      method: 'POST',
      headers: authHeaders,
    });
    expect(res.status).toBe(200);
    expect(removeWorktree).toHaveBeenCalledWith('/repo/.wt/wt-e', '/repo/.wt/wt-e');

    const row = repo.findById(id);
    expect(row).toBeTruthy();
    expect(row?.worktreePath).toBeNull();
    expect(row?.worktreeBranch).toBeNull();
    expect(row?.worktreeName).toBeNull();
  });

  it('POST .../worktree/remove on a non-isolated session → 400', async () => {
    const createRes = await fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ agentId: 'claude-code', cwd: os.homedir(), name: 'S' }),
    });
    const { id } = (await createRes.json()) as { id: string };

    const res = await fetch(`${baseUrl}/agent-sessions/${id}/worktree/remove`, {
      method: 'POST',
      headers: authHeaders,
    });
    expect(res.status).toBe(400);
    expect(removeWorktree).not.toHaveBeenCalled();
  });

  it('migration adds worktree columns to agent_sessions', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const cols = (db.pragma('table_info(agent_sessions)') as { name: string }[]).map((c) => c.name);
    expect(cols).toContain('worktree_name');
    expect(cols).toContain('worktree_path');
    expect(cols).toContain('worktree_branch');
    const marker = db
      .prepare(`SELECT key FROM schema_meta WHERE key = 'issue_1058_worktree_fields'`)
      .get();
    expect(marker).toBeTruthy();
  });
});
