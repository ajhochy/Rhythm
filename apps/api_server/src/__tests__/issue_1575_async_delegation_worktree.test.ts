import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { getDb, setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';

const { engine, sessionMap, streamSession } = vi.hoisted(() => ({
  engine: {
    createSession: vi.fn(),
    createWorktree: vi.fn(),
    listAuthedProviders: vi.fn(),
    listModels: vi.fn(),
    listProviders: vi.fn(),
    promptAsync: vi.fn(),
    removeWorktree: vi.fn(),
  },
  sessionMap: new Map<string, string>(),
  streamSession: vi.fn(),
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: engine,
  opencodeSessionMap: sessionMap,
}));
vi.mock('../services/opencode_stream_bridge', () => ({
  streamBridge: { streamSession },
}));

import { delegateToAgentAsync } from '../services/agent_delegation_service';
import { AgentDelegationController } from '../controllers/agent_delegation_controller';

function seedProfile(id: string, manager = false): void {
  new AgentConfigsRepository().insert({
    id,
    label: id,
    icon: 'agent',
    enabled: true,
    isAgent: true,
    isManager: manager,
    sessionSelectable: true,
    allowedDelegatesJson: manager ? JSON.stringify(['specialist']) : null,
    modelProvider: 'google',
    modelId: 'gemini-2.5-pro',
    ocAgent: id,
    corePermissionsJson: JSON.stringify({ rhythm_delegate_async: 'allow' }),
  });
}

function seedParent(): ReturnType<AgentSessionsRepository['findById']> {
  const repo = new AgentSessionsRepository();
  const parent = repo.insert({
    agentKind: 'manager' as never,
    taskId: null,
    cwd: '/repo/manager',
    name: 'manager',
    mcpRole: 'manager',
    ownerUserId: 42,
  });
  repo.setSdkSessionId(parent.id, 'sdk-parent');
  return repo.findById(parent.id);
}

describe('issue #1575 — isolated async delegation worktree contract', () => {
  beforeEach(() => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);
    getDb().prepare("INSERT INTO users (id, name, email) VALUES (42, 'Test', 'issue-1575@example.com')").run();
    sessionMap.clear();
    vi.clearAllMocks();
    engine.createWorktree.mockResolvedValue({
      name: 'issue-1575-child',
      branch: 'agent/issue-1575-child',
      directory: '/repo/.worktrees/issue-1575-child',
    });
    engine.createSession.mockResolvedValue({ id: 'sdk-child' });
    engine.promptAsync.mockResolvedValue(true);
    engine.listAuthedProviders.mockResolvedValue(['google']);
    engine.listModels.mockResolvedValue([{ id: 'gemini-2.5-pro' }]);
    engine.listProviders.mockResolvedValue([]);
    streamSession.mockResolvedValue(undefined);
  });

  it('issue-1575-c2: creates the requested worktree and runs the child only in that directory', async () => {
    // Regression caught: async delegation accepts isolation but runs a child in
    // the manager cwd; all assertions below fail when that manager cwd leaks.
    seedProfile('manager', true);
    seedProfile('specialist');
    const parent = seedParent()!;

    const result = await delegateToAgentAsync({
      authenticatedUserId: 42,
      callerSessionId: parent.id,
      targetAgentConfigId: 'specialist',
      prompt: 'Inspect cwd.',
      isolateWorktree: true,
      worktreeName: 'issue-1575-child',
    });

    const worktreeDir = '/repo/.worktrees/issue-1575-child';
    expect(engine.createWorktree).toHaveBeenCalledWith('/repo/manager', { name: 'issue-1575-child' });
    expect(engine.createSession).toHaveBeenCalledWith(expect.any(String), worktreeDir, undefined, undefined, 'google', 'sdk-parent');
    expect(streamSession).toHaveBeenCalledWith(result.sessionId, 'sdk-child', worktreeDir);
    expect(engine.promptAsync).toHaveBeenCalledWith('sdk-child', 'Inspect cwd.', expect.any(Object), worktreeDir, expect.any(Object));
    expect(engine.removeWorktree).not.toHaveBeenCalled();
  });

  it('issue-1575-c3: persists the created worktree metadata on the child row', async () => {
    seedProfile('manager', true);
    seedProfile('specialist');
    const result = await delegateToAgentAsync({
      authenticatedUserId: 42,
      callerSessionId: seedParent()!.id,
      targetAgentConfigId: 'specialist',
      prompt: 'Inspect cwd.',
      isolateWorktree: true,
      worktreeName: 'issue-1575-child',
    });

    expect(new AgentSessionsRepository().findById(result.sessionId)).toMatchObject({
      cwd: '/repo/.worktrees/issue-1575-child',
      worktreeName: 'issue-1575-child',
      worktreePath: '/repo/.worktrees/issue-1575-child',
      worktreeBranch: 'agent/issue-1575-child',
    });
  });

  it('issue-1575-c3: preserves child worktree metadata when enqueue fails', async () => {
    seedProfile('manager', true);
    seedProfile('specialist');
    engine.promptAsync.mockResolvedValueOnce(false);

    await expect(delegateToAgentAsync({
      authenticatedUserId: 42,
      callerSessionId: seedParent()!.id,
      targetAgentConfigId: 'specialist',
      prompt: 'Fail after child creation.',
      isolateWorktree: true,
      worktreeName: 'issue-1575-child',
    })).rejects.toThrow('failed to enqueue async delegated prompt');

    expect(new AgentSessionsRepository().findBySdkSessionId('sdk-child')).toMatchObject({
      cwd: '/repo/.worktrees/issue-1575-child',
      worktreeName: 'issue-1575-child',
      worktreePath: '/repo/.worktrees/issue-1575-child',
      worktreeBranch: 'agent/issue-1575-child',
    });
  });

  it('issue-1575-c3: a late child upsert preserves child-owned worktree metadata', () => {
    const repo = new AgentSessionsRepository();
    const parent = seedParent()!;
    repo.setWorktree(parent.id, {
      name: 'manager-worktree',
      path: '/repo/manager',
      branch: 'manager-branch',
    });
    const child = repo.upsertChildSession(
      'sdk-child',
      'sdk-parent',
      'Async delegation: specialist (@specialist subagent)',
      '/repo/.worktrees/issue-1575-child',
    )!;
    repo.setWorktree(child.id, {
      name: 'issue-1575-child',
      path: '/repo/.worktrees/issue-1575-child',
      branch: 'agent/issue-1575-child',
    });

    const repeated = repo.upsertChildSession(
      'sdk-child',
      'sdk-parent',
      'Async delegation: specialist (@specialist subagent)',
      '/repo/manager',
    );

    expect(repeated).toMatchObject({
      id: child.id,
      worktreeName: 'issue-1575-child',
      worktreePath: '/repo/.worktrees/issue-1575-child',
      worktreeBranch: 'agent/issue-1575-child',
    });
  });

  it('issue-1575-c5: omitting isolation keeps the manager cwd and creates no worktree', async () => {
    seedProfile('manager', true);
    seedProfile('specialist');
    const result = await delegateToAgentAsync({
      authenticatedUserId: 42,
      callerSessionId: seedParent()!.id,
      targetAgentConfigId: 'specialist',
      prompt: 'Keep current behavior.',
    });

    expect(engine.createWorktree).not.toHaveBeenCalled();
    expect(engine.createSession).toHaveBeenCalledWith(expect.any(String), '/repo/manager', undefined, undefined, 'google', 'sdk-parent');
    expect(engine.removeWorktree).not.toHaveBeenCalled();
    expect(new AgentSessionsRepository().findById(result.sessionId)).toMatchObject({
      cwd: '/repo/manager',
      worktreeName: null,
      worktreePath: null,
      worktreeBranch: null,
    });
  });

  it('issue-1575-c6: leaves an isolated worktree intact after dispatch', async () => {
    seedProfile('manager', true);
    seedProfile('specialist');
    await delegateToAgentAsync({
      authenticatedUserId: 42,
      callerSessionId: seedParent()!.id,
      targetAgentConfigId: 'specialist',
      prompt: 'Keep the worktree.',
      isolateWorktree: true,
      worktreeName: 'issue-1575-child',
    });

    expect(engine.removeWorktree).not.toHaveBeenCalled();
  });

  it('issue-1575-c7: rejects a supplied non-boolean isolation flag before dispatch', async () => {
    // Regression caught: the string "true" was coerced to false and sent a
    // child into the manager cwd; BAD_REQUEST must stop that dispatch.
    seedProfile('manager', true);
    seedProfile('specialist');
    const parent = seedParent()!;
    const next = vi.fn();
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };

    await new AgentDelegationController().delegateAsync(
      {
        auth: { user: { id: 42 } },
        body: {
          callerSessionId: parent.id,
          targetAgentConfigId: 'specialist',
          prompt: 'Inspect cwd.',
          isolateWorktree: 'true',
        },
      } as never,
      res as never,
      next,
    );

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 400, code: 'BAD_REQUEST' }),
    );
    expect(engine.createWorktree).not.toHaveBeenCalled();
    expect(engine.createSession).not.toHaveBeenCalled();
  });
});
