import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { getDb, setDb } from '../database/db';
import { startTestServer } from './helpers/real_server';
import { UsersRepository } from '../repositories/users_repository';
import { SessionsRepository } from '../repositories/sessions_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';

const removeWorktree = vi.fn();
const deleteSession = vi.fn().mockResolvedValue(true);

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    isReady: true,
    statusMessage: 'ready',
    removeWorktree: (...args: unknown[]) => removeWorktree(...args),
    deleteSession: (...args: unknown[]) => deleteSession(...args),
  },
  opencodeSessionMap: new Map<string, string>(),
}));

vi.mock('../services/opencode_stream_bridge', () => ({
  streamBridge: {
    streamSession: vi.fn(),
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

describe('post-m1 Phase 6 files/worktrees acceptance contract', () => {
  let baseUrl: string;
  let close: () => Promise<void>;
  let headers: Record<string, string>;
  let repo: AgentSessionsRepository;

  beforeEach(async () => {
    setDb(makeDb());
    const user = new UsersRepository().create({ name: 'Phase 6', email: 'phase6@example.test' });
    const auth = await new SessionsRepository().createAsync(user.id);
    headers = { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' };
    repo = new AgentSessionsRepository();
    removeWorktree.mockReset();
    deleteSession.mockClear();
    const { createApp } = await import('../app');
    ({ baseUrl, close } = await startTestServer(createApp()));
  });

  afterEach(async () => {
    await close();
    vi.clearAllMocks();
  });

  it('post-m1-p6-c4a: hard delete fails closed when engine worktree removal returns false', async () => {
    // Regression caught: destroy ignores removeWorktree=false, deletes the durable row, broadcasts
    // removal, and returns 204 while the engine-side worktree can still exist. The non-204 and
    // retained-identity assertions fail against that false-success behavior.
    removeWorktree.mockResolvedValueOnce(false);
    const inserted = repo.insert({
      agentKind: 'claude-code',
      taskId: null,
      cwd: '/phase6/worktrees/nonce-false-success',
      name: 'phase6-nonce-false-success',
    } as never);
    getDb().prepare(
      `UPDATE agent_sessions
          SET worktree_name = ?, worktree_path = ?, worktree_branch = ?
        WHERE id = ?`,
    ).run(
      'nonce-false-success',
      '/phase6/worktrees/nonce-false-success',
      'opencode/nonce-false-success',
      inserted.id,
    );
    const row = repo.findById(inserted.id)!;

    const response = await fetch(`${baseUrl}/agent-sessions/${row.id}/hard`, {
      method: 'DELETE',
      headers,
      body: JSON.stringify({ removeWorktree: true }),
    });

    expect(removeWorktree).toHaveBeenCalledWith(
      '/phase6/worktrees/nonce-false-success',
      '/phase6/worktrees/nonce-false-success',
    );
    expect(response.status, 'false engine cleanup must not be reported as HTTP 204 success').not.toBe(204);
    expect(repo.findById(row.id)).toMatchObject({
      worktreeName: 'nonce-false-success',
      worktreePath: '/phase6/worktrees/nonce-false-success',
      worktreeBranch: 'opencode/nonce-false-success',
    });
    expect(deleteSession).not.toHaveBeenCalled();
  });
});
