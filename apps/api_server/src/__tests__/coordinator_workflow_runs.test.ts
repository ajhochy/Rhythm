/**
 * Contract: docs/ai/contracts/coordinator-workflow-runs.json
 * Plan:     docs/ai/plans/2026-10-12-coordinator-workflow-runs.md
 *
 * One Coordinator chat starts one existing workflow-orchestrator run per goal
 * (own worktree of the repo the user named), tracks several at once, and the
 * existing completion wake reports each run with its branch.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getDb, setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { CoordinatorConversationsRepository } from '../repositories/coordinator_conversations_repository';

const { engine, sessionMap, streamSession } = vi.hoisted(() => ({
  engine: {
    createSession: vi.fn(),
    createWorktree: vi.fn(),
    listAuthedProviders: vi.fn(),
    listModels: vi.fn(),
    listProviders: vi.fn(),
    promptAsync: vi.fn(),
    abortSession: vi.fn(),
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
import { goalRepoPath } from '../services/coordinator_goal_repo';
import { listCoordinatorGoalRuns } from '../services/coordinator_goal_runs';
import { AsyncDelegationCompletionService } from '../services/async_delegation_completion_service';

const NOW = '2026-10-12T12:00:00.000Z';

function gitRepo(): string {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'coord-runs-')));
  execFileSync('git', ['init', '-q', dir]);
  return dir;
}

function seedProfile(id: string, manager = false, delegates: string[] = []): void {
  new AgentConfigsRepository().insert({
    id,
    label: id,
    icon: 'agent',
    enabled: true,
    isAgent: true,
    isManager: manager,
    sessionSelectable: true,
    allowedDelegatesJson: manager ? JSON.stringify(delegates) : null,
    modelProvider: 'google',
    modelId: 'gemini-2.5-pro',
    ocAgent: id,
    corePermissionsJson: JSON.stringify({ rhythm_delegate_async: 'allow' }),
  });
}

function seedPlanRoot(): string {
  const repo = new AgentSessionsRepository();
  const parent = repo.insert({
    agentKind: 'secretary' as never,
    taskId: null,
    cwd: '/coordinator/workspace',
    name: 'Rhythm Coordinator',
    mcpRole: 'secretary',
    ownerUserId: 42,
  });
  repo.setSdkSessionId(parent.id, 'sdk-root');
  repo.updatePermissionMode(parent.id, 'plan');
  return parent.id;
}

beforeEach(() => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
  getDb().prepare("INSERT INTO users (id, name, email) VALUES (42, 'Test', 'coord-runs@example.com')").run();
  sessionMap.clear();
  vi.clearAllMocks();
  engine.createSession.mockResolvedValue({ id: 'sdk-child' });
  engine.promptAsync.mockResolvedValue(true);
  engine.listAuthedProviders.mockResolvedValue(['google']);
  engine.listModels.mockResolvedValue([{ id: 'gemini-2.5-pro' }]);
  engine.listProviders.mockResolvedValue([]);
  streamSession.mockResolvedValue(undefined);
});

describe('coordinator-workflow-runs-c1: one run per goal in its own worktree of the named repo', () => {
  it('coordinator-workflow-runs-c1a: a plan-mode coordinator dispatches the orchestrator into a NEW worktree of the repo, in bypass mode', async () => {
    // Regression caught: the run inherits the coordinator's read-only plan mode
    // or runs in the coordinator workspace instead of a worktree of the repo.
    seedProfile('secretary', true, ['workflow-orchestrator']);
    seedProfile('workflow-orchestrator');
    const repoDir = gitRepo();
    engine.createWorktree.mockResolvedValue({
      name: 'goal-abc', branch: 'opencode/goal-abc', directory: `${repoDir}-wt/goal-abc`,
    });

    const result = await delegateToAgentAsync({
      authenticatedUserId: 42,
      callerSessionId: seedPlanRoot(),
      targetAgentConfigId: 'workflow-orchestrator',
      prompt: `fix the parser in ${repoDir}`,
      cwd: repoDir,
      isolateWorktree: true,
      worktreeName: 'goal-abc',
      childPermissionMode: 'bypassPermissions',
    });

    expect(engine.createWorktree).toHaveBeenCalledWith(repoDir, { name: 'goal-abc' });
    expect(engine.createSession.mock.calls[0]?.[1]).toBe(`${repoDir}-wt/goal-abc`);
    expect(engine.createSession.mock.calls[0]?.[6]).toBe('bypassPermissions');
    // Regression caught (seen live): the run cd'd into the original checkout
    // named in the goal and committed on its main branch.
    expect(engine.createSession.mock.calls[0]?.[10]).toBe(true);
    expect(engine.promptAsync.mock.calls[0]?.[1]).toBe(`fix the parser in ${repoDir}-wt/goal-abc`);
    expect(new AgentSessionsRepository().findById(result.sessionId)).toMatchObject({
      permissionMode: 'bypassPermissions',
      worktreePath: `${repoDir}-wt/goal-abc`,
      worktreeBranch: 'opencode/goal-abc',
    });
  });

  it('coordinator-workflow-runs-c1b: a bypass run outside an isolated worktree is refused before any child exists', async () => {
    // Regression caught: the bypass override escapes the worktree confinement
    // and runs unattended directly in a checkout.
    seedProfile('secretary', true, ['workflow-orchestrator']);
    seedProfile('workflow-orchestrator');
    await expect(delegateToAgentAsync({
      authenticatedUserId: 42,
      callerSessionId: seedPlanRoot(),
      targetAgentConfigId: 'workflow-orchestrator',
      prompt: 'fix it',
      cwd: gitRepo(),
      childPermissionMode: 'bypassPermissions',
    })).rejects.toThrow();
    expect(engine.createSession).not.toHaveBeenCalled();
  });

  it('coordinator-workflow-runs-c1c: the repo comes only from the user-authored goal text and must be one git work tree', () => {
    // Regression caught: a goal with no repo, two repos, or a non-git path
    // starts a run somewhere the user did not name.
    const repoDir = gitRepo();
    const other = gitRepo();
    const plain = realpathSync(mkdtempSync(path.join(tmpdir(), 'coord-plain-')));
    mkdirSync(path.join(plain, 'src'));
    expect(goalRepoPath(`Fix the date bug in ${repoDir}.`)).toBe(repoDir);
    expect(goalRepoPath(`fix ${repoDir}/ and also ${repoDir}`)).toBe(repoDir);
    expect(goalRepoPath('fix the date bug in the parser')).toBeNull();
    expect(goalRepoPath(`fix ${repoDir} and ${other}`)).toBeNull();
    expect(goalRepoPath(`fix ${plain}`)).toBeNull();
  });
});

describe('coordinator-workflow-runs-c1e: specialists a run delegates to stay confined to its worktree', () => {
  it('coordinator-workflow-runs-c1e: an orchestrator run in bypass delegates a confined child in the same worktree', async () => {
    // Regression caught: the coding-agent the orchestrator delegates to runs in
    // plain bypass and can still write outside the run's worktree.
    seedProfile('workflow-orchestrator', true, ['coding-agent']);
    seedProfile('coding-agent');
    const repo = new AgentSessionsRepository();
    const run = repo.insert({ agentKind: 'workflow-orchestrator' as never, taskId: null, cwd: '/wt/goal-1', name: 'run', mcpRole: 'workflow-orchestrator', ownerUserId: 42 });
    repo.setSdkSessionId(run.id, 'sdk-run');
    repo.updatePermissionMode(run.id, 'bypassPermissions');
    repo.setWorktree(run.id, { name: 'goal-1', path: '/wt/goal-1', branch: 'opencode/goal-1' });
    await delegateToAgentAsync({
      authenticatedUserId: 42, callerSessionId: run.id, targetAgentConfigId: 'coding-agent', prompt: 'make the fix',
    });
    expect(engine.createSession.mock.calls[0]?.[1]).toBe('/wt/goal-1');
    expect(engine.createSession.mock.calls[0]?.[6]).toBe('bypassPermissions');
    expect(engine.createSession.mock.calls[0]?.[10]).toBe(true);
  });
});

describe('coordinator-workflow-runs-c3: the run list reports goal, repo/branch, status and actual usage', () => {
  function seedSession(id: string, parent: string | null, extra: Record<string, unknown> = {}): void {
    getDb().prepare(`INSERT INTO agent_sessions
      (id, name, agent_kind, status, cwd, sdk_session_id, category, owner_user_id, project_id, parent_session_id,
       profile_id, worktree_path, worktree_branch, created_at, updated_at)
      VALUES (@id, @id, 'secretary', 'idle', '/x', @sdk, 'chat', 42, 'project-a', @parent, @profile, @wtPath, @wtBranch, @now, @now)`)
      .run({ id, sdk: `sdk-${id}`, parent, profile: 'secretary', wtPath: null, wtBranch: null, now: NOW, ...extra });
  }
  function tokens(session: string, total: number, cost: number): void {
    getDb().prepare(`INSERT INTO agent_session_messages (session_id, role, raw_text, stripped_text, tokens_json, cost)
      VALUES (?, 'output', 'x', 'x', ?, ?)`)
      .run(session, JSON.stringify({ input: total - 10, output: 10, reasoning: 0, cache: { read: 0, write: 0 }, total }), cost);
  }
  function delegation(id: string, child: string, status: string, error: string | null = null): void {
    getDb().prepare(`INSERT INTO agent_async_delegations
      (id, parent_session_id, child_session_id, target_agent_config_id, status, error_text, completed_at, notified_at, created_at, updated_at)
      VALUES (?, 'root', ?, 'workflow-orchestrator', ?, ?, ?, ?, ?, ?)`)
      .run(id, child, status, error, status === 'dispatched' ? null : NOW, status === 'notified' ? NOW : null, NOW, NOW);
  }

  it('coordinator-workflow-runs-c3: lists every dispatched goal with live branch, mapped status, reported flag and summed tree usage', () => {
    // Regressions caught: usage counts only the orchestrator (not the
    // coding-agent it delegated to), a pending question shows as "running",
    // a delivered result is not marked reported, or branch is the stale label.
    getDb().prepare("INSERT INTO projects (id, name, cwd, created_at) VALUES ('project-a', 'Rhythm Coordinator', '/x', ?)").run(NOW);
    seedProfile('secretary', true, ['workflow-orchestrator']);
    seedSession('root', null, { sdk: 'sdk-root' });
    const repository = new CoordinatorConversationsRepository(getDb(), () => new Date(NOW));
    const scope = { ownerUserId: 42, projectId: 'project-a', sessionId: 'root' };
    expect(repository.designatePrimaryOwnerRoot(scope)).toMatchObject({ kind: 'found' });
    const goals = ['fix A in /r/a', 'fix B in /r/b', 'fix C in /r/c', 'fix D in /r/d'];
    goals.forEach((objective, index) => {
      const read = repository.get(scope);
      if (read.kind !== 'found') throw new Error('conversation');
      const added = repository.addGoal({ ...scope, expectedControlRevision: read.conversation.controlRevision, commandKey: `g${index}`, objective });
      if (added.kind !== 'created') throw new Error(`goal ${added.kind}`);
      const goalId = added.goal.id;
      const reserved = repository.reserveGoalDelegation({ ...scope, expectedControlRevision: added.conversation.controlRevision, commandKey: `d${index}`, goalId, parentSdkSessionId: 'sdk-root' });
      if (reserved.kind !== 'reserved') throw new Error(`reserve ${reserved.kind}`);
      seedSession(`child-${index}`, 'root', { wtPath: `/wt/${index}`, wtBranch: `opencode/goal-${index}` });
      repository.settleGoalDelegation({ ...scope, expectedControlRevision: reserved.conversation.controlRevision, commandKey: `d${index}`, goalId, outcome: 'dispatched', delegationId: `dg-${index}`, childSessionId: `child-${index}` });
    });
    seedSession('grandchild-0', 'child-0');
    seedSession('unrelated', null);
    delegation('dg-0', 'child-0', 'dispatched');
    delegation('dg-1', 'child-1', 'dispatched');
    delegation('dg-2', 'child-2', 'notified');
    delegation('dg-3', 'child-3', 'completed', 'session error');
    tokens('child-0', 100, 0.01);
    tokens('grandchild-0', 50, 0.02);
    tokens('unrelated', 999, 9);

    const runs = listCoordinatorGoalRuns(repository, scope, {
      pendingSessionIds: new Set(['grandchild-0']),
      gitBranch: (dir) => (dir === '/wt/1' ? 'feature/b-fix' : null),
    });

    expect(runs).toHaveLength(4);
    expect(runs[0]).toMatchObject({
      objective: 'fix A in /r/a', status: 'needs_you', reported: false,
      worktreePath: '/wt/0', branch: 'opencode/goal-0',
      usage: { totalTokens: 150, inputTokens: 130, outputTokens: 20 },
    });
    expect(runs[0]!.usage.cost).toBeCloseTo(0.03);
    expect(runs[1]).toMatchObject({ status: 'running', branch: 'feature/b-fix', usage: { totalTokens: 0 } });
    expect(runs[2]).toMatchObject({ status: 'finished', reported: true });
    expect(runs[3]).toMatchObject({ status: 'failed' });
  });
});

describe('coordinator-workflow-runs-c5: the completion report names the run branch', () => {
  it('coordinator-workflow-runs-c5: each wake block carries its worktree branch and path', () => {
    // Regression caught: two runs finish and the coordinator cannot tell which
    // branch each report belongs to.
    for (const [id, branch] of [['parent', null], ['child-1', 'opencode/goal-1'], ['child-2', 'opencode/goal-2']] as const) {
      getDb().prepare(`INSERT INTO agent_sessions (id, name, agent_kind, status, cwd, sdk_session_id, category, worktree_path, worktree_branch)
        VALUES (?, ?, 'workflow-orchestrator', 'idle', '/tmp', ?, 'chat', ?, ?)`)
        .run(id, id, `sdk-${id}`, branch ? `/wt/${id}` : null, branch);
    }
    for (const n of [1, 2]) {
      getDb().prepare(`INSERT INTO agent_async_delegations
        (id, parent_session_id, child_session_id, target_agent_config_id, status, completion_text, created_at, updated_at)
        VALUES (?, 'parent', ?, 'workflow-orchestrator', 'completed', ?, ?, ?)`)
        .run(`dg-${n}`, `child-${n}`, `report ${n}`, NOW, NOW);
    }
    const svc = new AsyncDelegationCompletionService() as unknown as {
      buildWakeText: (rows: unknown[], messageID?: string) => string;
    };
    const rows = ['dg-1', 'dg-2'].map((id) => getDb().prepare(`SELECT id, parent_session_id AS parentSessionId,
      child_session_id AS childSessionId, target_agent_config_id AS targetAgentConfigId, status,
      completion_text AS completionText, error_text AS errorText FROM agent_async_delegations WHERE id=?`).get(id));
    const text = svc.buildWakeText(rows, 'msg_test');
    expect(text).toContain('branch opencode/goal-1 (worktree /wt/child-1)');
    expect(text).toContain('branch opencode/goal-2 (worktree /wt/child-2)');
    expect(text.indexOf('opencode/goal-1')).toBeLessThan(text.indexOf('report 1'));
  });
});
