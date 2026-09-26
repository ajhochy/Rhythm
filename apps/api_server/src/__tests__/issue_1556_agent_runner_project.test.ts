import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../database/migrations';
import { getDb, setDb } from '../database/db';
import { ProjectsRepository } from '../repositories/projects_repository';

const mocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  prompt: vi.fn(),
  createWorktree: vi.fn(),
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    get isReady() { return true; },
    ensureReady: vi.fn().mockResolvedValue(true),
    createSession: mocks.createSession,
    prompt: mocks.prompt,
    createWorktree: mocks.createWorktree,
    abortSession: vi.fn().mockResolvedValue(true),
    listMcp: vi.fn().mockResolvedValue({}),
  },
  opencodeSessionMap: new Map<string, string>(),
}));

import { run } from '../services/agent_runner';

describe('#1556 AgentRunner project association', () => {
  let projectId: string;

  beforeEach(() => {
    vi.clearAllMocks();
    const db = new Database(':memory:');
    runMigrations(db);
    setDb(db);
    projectId = new ProjectsRepository().insert({
      name: 'Runner project',
      cwd: '/fixture/project',
      icon: null,
      vcs: { vcsRoot: null, vcsBranch: null, vcsDirty: false, vcsCheckedAt: null },
    }).id;
    mocks.createSession.mockResolvedValue({ id: 'sdk-1556-runner' });
    mocks.prompt.mockResolvedValue({
      info: { sessionID: 'sdk-1556-runner' },
      parts: [{ type: 'text', text: 'done' }],
    });
    mocks.createWorktree.mockResolvedValue({
      name: 'runner-worktree',
      branch: 'agent/runner-worktree',
      directory: '/tmp/opencode/worktree/hash/runner-worktree',
    });
  });

  it('1556-resolve-project-from-requested-cwd:7 records the requested cwd project without isolation', async () => {
    const result = await run({ prompt: 'Runner project', cwd: '/fixture/project/subdir' });
    expect(result.status).toBe('done');
    const row = getDb().prepare('SELECT project_id FROM agent_sessions WHERE id = ?').get(result.sessionId) as { project_id: string | null };
    expect(row.project_id).toBe(projectId);
  });

  it('1556-resolve-project-from-requested-cwd:8 records the requested cwd project when the effective cwd is an external worktree', async () => {
    const result = await run({
      prompt: 'Runner isolated project',
      cwd: '/fixture/project/subdir',
      isolateWorktree: true,
      worktreeName: 'runner-worktree',
    });
    expect(result.status).toBe('done');
    const row = getDb().prepare('SELECT project_id, cwd FROM agent_sessions WHERE id = ?').get(result.sessionId) as { project_id: string | null; cwd: string };
    expect(row.project_id).toBe(projectId);
    expect(row.cwd).toBe('/tmp/opencode/worktree/hash/runner-worktree');
  });
});
