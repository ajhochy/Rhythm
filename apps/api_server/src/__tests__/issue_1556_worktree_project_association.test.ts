import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../database/migrations';
import { getDb, setDb } from '../database/db';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { ProjectsRepository } from '../repositories/projects_repository';
import { SessionsRepository } from '../repositories/sessions_repository';
import { UsersRepository } from '../repositories/users_repository';
import { startTestServer } from './helpers/real_server';

const createWorktree = vi.fn();
const removeWorktree = vi.fn().mockResolvedValue(true);
const resetWorktree = vi.fn().mockResolvedValue(true);

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    isReady: true,
    statusMessage: 'ready',
    ensureReady: vi.fn().mockResolvedValue(true),
    createSession: vi.fn().mockResolvedValue({ id: 'sdk-1556' }),
    createWorktree: (...args: unknown[]) => createWorktree(...args),
    removeWorktree: (...args: unknown[]) => removeWorktree(...args),
    resetWorktree: (...args: unknown[]) => resetWorktree(...args),
    deleteSession: vi.fn().mockResolvedValue(true),
  },
  opencodeSessionMap: new Map<string, string>(),
}));

vi.mock('../services/opencode_stream_bridge', () => ({
  streamBridge: {
    streamSession: vi.fn().mockResolvedValue(undefined),
    stopStream: vi.fn(),
    clearErrorStatus: vi.fn(),
    dispose: vi.fn(),
  },
}));

function insertProject(cwd: string, name = 'Fixture project') {
  return new ProjectsRepository().insert({
    name,
    cwd,
    icon: null,
    vcs: { vcsRoot: null, vcsBranch: null, vcsDirty: false, vcsCheckedAt: null },
  });
}

describe('#1556 worktree project association', () => {
  let baseUrl: string;
  let close: () => Promise<void>;
  let headers: Record<string, string>;
  const tempRoots: string[] = [];

  beforeEach(async () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);
    const user = new UsersRepository().create({ name: 'Issue 1556', email: '1556@example.test' });
    const auth = await new SessionsRepository().createAsync(user.id);
    headers = { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' };
    ({ baseUrl, close } = await startTestServer((await import('../app')).createApp()));
    createWorktree.mockReset();
    removeWorktree.mockClear();
    resetWorktree.mockClear();
  }, 30_000);

  afterEach(async () => {
    await close();
    for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  async function createSession(body: Record<string, unknown>) {
    const response = await fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ agentId: 'claude-code', name: 'Issue 1556', ...body }),
    });
    expect(response.status).toBe(201);
    return (await response.json()) as { id: string; projectId: string | null; cwd: string };
  }

  it('1556-resolve-project-from-requested-cwd:1 stores the requested cwd project for an isolated worktree', async () => {
    const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'rhythm-1556-project-'));
    tempRoots.push(projectRoot);
    const project = insertProject(projectRoot);
    const externalWorktree = path.join(os.tmpdir(), '.local', 'share', 'opencode', 'worktree', 'hash', 'slug');
    createWorktree.mockResolvedValue({ name: 'slug', branch: 'agent/slug', directory: externalWorktree });

    const created = await createSession({ cwd: projectRoot, isolateWorktree: true });

    expect(created.projectId).toBe(project.id);
    expect(created.cwd).toBe(externalWorktree);
    const persisted = getDb()
      .prepare('SELECT project_id FROM agent_sessions WHERE id = ?')
      .get(created.id) as { project_id: string | null };
    expect(persisted.project_id).toBe(project.id);
  });

  it('1556-resolve-project-from-requested-cwd:2 keeps unmatched sessions unassigned with and without isolation', async () => {
    const unknownRoot = mkdtempSync(path.join(os.tmpdir(), 'rhythm-1556-unmatched-'));
    tempRoots.push(unknownRoot);
    createWorktree.mockResolvedValue({ name: 'outside', branch: 'agent/outside', directory: `${unknownRoot}-worktree` });

    expect((await createSession({ cwd: unknownRoot })).projectId).toBeNull();
    expect((await createSession({ cwd: unknownRoot, isolateWorktree: true })).projectId).toBeNull();
  });

  it('1556-resolve-project-from-requested-cwd:3 preserves explicit project ids and explicit null', async () => {
    const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'rhythm-1556-explicit-'));
    const otherRoot = mkdtempSync(path.join(os.tmpdir(), 'rhythm-1556-other-'));
    tempRoots.push(projectRoot, otherRoot);
    insertProject(projectRoot, 'Inferred');
    const other = insertProject(otherRoot, 'Explicit');

    expect((await createSession({ cwd: projectRoot, projectId: other.id })).projectId).toBe(other.id);
    expect((await createSession({ cwd: projectRoot, projectId: null })).projectId).toBeNull();
  });

  it('1556-resolve-project-from-requested-cwd:4 resolves symlinks in either direction', () => {
    const visibleRoot = mkdtempSync(path.join(os.tmpdir(), 'rhythm-1556-symlink-'));
    tempRoots.push(visibleRoot);
    const realRoot = realpathSync(visibleRoot);
    mkdirSync(path.join(visibleRoot, 'nested'));
    const repo = new ProjectsRepository();
    const project = insertProject(visibleRoot);

    expect(repo.findByCwdPrefix(path.join(realRoot, 'nested'))?.id).toBe(project.id);
    repo.updateFields(project.id, { cwd: realRoot });
    expect(repo.findByCwdPrefix(path.join(visibleRoot, 'nested'))?.id).toBe(project.id);
  });

  it('1556-resolve-project-from-requested-cwd:5 keeps longest-prefix and trailing-slash behavior', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'rhythm-1556-nested-'));
    tempRoots.push(root);
    const outer = insertProject(`${root}/`, 'Outer');
    const nestedPath = path.join(root, 'a', 'b');
    mkdirSync(nestedPath, { recursive: true });
    const nested = insertProject(`${nestedPath}/`, 'Nested');
    const repo = new ProjectsRepository();

    expect(repo.findByCwdPrefix(path.join(nestedPath, 'c'))?.id).toBe(nested.id);
    expect(repo.findByCwdPrefix(root)?.id).toBe(outer.id);
  });

  it('1556-resolve-project-from-requested-cwd:6 uses the git primary worktree for reset and removal even when the project cwd is a non-git parent', async () => {
    const parent = mkdtempSync(path.join(os.tmpdir(), 'rhythm-1556-parent-'));
    const primary = path.join(parent, 'repo');
    const linked = `${parent}-linked`;
    tempRoots.push(parent, linked);
    mkdirSync(primary);
    const git = (args: string[]) => execFileSync('git', ['-C', primary, ...args]);
    git(['init', '-b', 'main']);
    git(['config', 'user.email', '1556@rhythm.test']);
    git(['config', 'user.name', 'Issue 1556']);
    writeFileSync(path.join(primary, 'README.md'), '# 1556\n');
    git(['add', '.']);
    git(['commit', '-m', 'init']);
    git(['worktree', 'add', '-b', 'agent/1556', linked]);
    const project = insertProject(parent);
    createWorktree.mockResolvedValue({ name: 'linked', branch: 'agent/1556', directory: linked });
    const created = await createSession({ cwd: primary, isolateWorktree: true });
    expect(created.projectId).toBe(project.id);

    const reset = await fetch(`${baseUrl}/agent-sessions/${created.id}/worktree/reset`, { method: 'POST', headers });
    expect(reset.status).toBe(200);
    expect(resetWorktree).toHaveBeenCalledWith(realpathSync(primary), linked);

    const remove = await fetch(`${baseUrl}/agent-sessions/${created.id}/worktree/remove`, { method: 'POST', headers });
    expect(remove.status).toBe(200);
    expect(removeWorktree).toHaveBeenCalledWith(realpathSync(primary), linked);
  });
});
