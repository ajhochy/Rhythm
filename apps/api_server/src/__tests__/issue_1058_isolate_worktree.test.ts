import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'fs';
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
const deleteSession = vi.fn().mockResolvedValue(true);

vi.mock('../services/opencode_engine', () => {
  const mockClient = {
    isReady: true,
    statusMessage: 'Opencode SDK ready',
    createSession: vi.fn().mockResolvedValue({ id: 'sdk-session-1' }),
    ensureReady: vi.fn().mockResolvedValue(true),
    getSessionDiff: vi.fn().mockResolvedValue([]),
    abortSession: vi.fn().mockResolvedValue(true),
    deleteSession: (...a: unknown[]) => deleteSession(...a),
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
    deleteSession.mockClear();
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

  it('uses the primary worktree as engine directory and deletes the engine session first', async () => {
    const primary = mkdtempSync(path.join(os.tmpdir(), 'rhythm-1058-primary-'));
    const linked = `${primary}-linked`;
    try {
      const git = (args: string[]) => execFileSync('git', ['-C', primary, ...args]);
      git(['init', '-b', 'main']);
      git(['config', 'user.email', '1058@rhythm.test']);
      git(['config', 'user.name', '1058']);
      writeFileSync(path.join(primary, 'README.md'), '# 1058\n');
      git(['add', '.']);
      git(['commit', '-m', 'init']);
      git(['worktree', 'add', '-b', 'agent/1058-test', linked]);

      createWorktree.mockResolvedValue({
        name: 'wt-primary',
        branch: 'agent/1058-test',
        directory: linked,
      });
      const createRes = await fetch(`${baseUrl}/agent-sessions`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ agentId: 'claude-code', cwd: linked, name: 'S', isolateWorktree: true }),
      });
      const { id } = (await createRes.json()) as { id: string };

      const delRes = await fetch(`${baseUrl}/agent-sessions/${id}/hard?removeWorktree=true`, {
        method: 'DELETE',
        headers: authHeaders,
      });

      expect(delRes.status).toBe(204);
      expect(removeWorktree).toHaveBeenCalledWith(realpathSync(primary), linked);
      expect(deleteSession.mock.invocationCallOrder[0]).toBeLessThan(
        removeWorktree.mock.invocationCallOrder[0],
      );
    } finally {
      rmSync(linked, { recursive: true, force: true });
      rmSync(primary, { recursive: true, force: true });
    }
  });

  it('retains the local row and metadata when opted-in worktree removal fails', async () => {
    createWorktree.mockResolvedValue({ name: 'wt-fail', branch: 'fail', directory: '/repo/.wt/wt-fail' });
    removeWorktree.mockResolvedValueOnce(false);
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

    expect(delRes.status).toBe(502);
    expect(deleteSession).toHaveBeenCalled();
    expect(repo.findById(id)).toMatchObject({
      worktreePath: '/repo/.wt/wt-fail',
      worktreeBranch: 'fail',
      worktreeName: 'wt-fail',
    });
  });

  it('parses and probes the primary worktree path while failing closed on malformed output', async () => {
    const vcsProbe = await import('../services/vcs_probe');
    const parse = (vcsProbe as unknown as {
      parsePrimaryWorktreePath?: (value: string) => string | null;
    }).parsePrimaryWorktreePath;
    const probe = (vcsProbe as unknown as {
      getPrimaryWorktreePath?: (cwd: string) => string | null;
    }).getPrimaryWorktreePath;
    expect(parse).toBeTypeOf('function');
    expect(probe).toBeTypeOf('function');
    if (!parse || !probe) return;

    expect(parse('worktree /repo\nHEAD abc\nbranch refs/heads/main\n\nworktree /repo-linked\nHEAD def\n')).toBe('/repo');
    expect(parse('worktree /bare/repo\nbare\n')).toBe('/bare/repo');
    expect(parse('HEAD abc\nbranch refs/heads/main\n')).toBeNull();

    const primary = mkdtempSync(path.join(os.tmpdir(), 'rhythm-1058-probe-'));
    const linked = `${primary}-linked`;
    try {
      const git = (args: string[]) => execFileSync('git', ['-C', primary, ...args]);
      git(['init', '-b', 'main']);
      git(['config', 'user.email', '1058@rhythm.test']);
      git(['config', 'user.name', '1058']);
      writeFileSync(path.join(primary, 'README.md'), '# probe\n');
      git(['add', '.']);
      git(['commit', '-m', 'init']);
      git(['worktree', 'add', '-b', 'agent/probe', linked]);
      expect(probe(linked)).toBe(realpathSync(primary));
      expect(probe(os.tmpdir())).toBeNull();
    } finally {
      rmSync(linked, { recursive: true, force: true });
      rmSync(primary, { recursive: true, force: true });
    }
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

  it('uses the primary worktree directory for standalone reset and removal', async () => {
    const primary = mkdtempSync(path.join(os.tmpdir(), 'rhythm-1058-actions-'));
    const linked = `${primary}-linked`;
    try {
      const git = (args: string[]) => execFileSync('git', ['-C', primary, ...args]);
      git(['init', '-b', 'main']);
      git(['config', 'user.email', '1058@rhythm.test']);
      git(['config', 'user.name', '1058']);
      writeFileSync(path.join(primary, 'README.md'), '# actions\n');
      git(['add', '.']);
      git(['commit', '-m', 'init']);
      git(['worktree', 'add', '-b', 'agent/actions', linked]);
      createWorktree.mockResolvedValue({ name: 'wt-actions', branch: 'agent/actions', directory: linked });
      const createRes = await fetch(`${baseUrl}/agent-sessions`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ agentId: 'claude-code', cwd: linked, name: 'S', isolateWorktree: true }),
      });
      const { id } = (await createRes.json()) as { id: string };

      expect((await fetch(`${baseUrl}/agent-sessions/${id}/worktree/reset`, {
        method: 'POST',
        headers: authHeaders,
      })).status).toBe(200);
      expect(resetWorktree).toHaveBeenCalledWith(realpathSync(primary), linked);

      expect((await fetch(`${baseUrl}/agent-sessions/${id}/worktree/remove`, {
        method: 'POST',
        headers: authHeaders,
      })).status).toBe(200);
      expect(removeWorktree).toHaveBeenCalledWith(realpathSync(primary), linked);
    } finally {
      rmSync(linked, { recursive: true, force: true });
      rmSync(primary, { recursive: true, force: true });
    }
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
