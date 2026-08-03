/**
 * Config Doctor Track D — D1 (run history) + D2 (honest terminal status).
 *
 * D1: agent_scheduled_tasks only ever kept ONE overwritten last-run slot, so
 * every prior run was invisible. Assert a run-history row is now written on
 * task completion (AgentScheduledTaskRunsRepository.create).
 *
 * D2: a run that AgentRunner reports 'done' is not automatically 'success' —
 * a still-pending approval must report 'blocked_on_approval', and a run that
 * performed zero mutating tool calls must report 'completed_no_op'. Mirrors
 * the dispatch-mocking pattern in scheduler_dispatch_contract.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const {
  mockRun,
  mockFindDueAsync,
  mockUpdateNextRunAsync,
  mockCreateRun,
  mockResetStaleRunning,
  mockDbGet,
  mockDbAll,
} = vi.hoisted(() => ({
  mockRun: vi.fn(),
  mockFindDueAsync: vi.fn(),
  mockUpdateNextRunAsync: vi.fn().mockResolvedValue(undefined),
  mockCreateRun: vi.fn().mockResolvedValue(undefined),
  mockResetStaleRunning: vi.fn().mockReturnValue(0),
  mockDbGet: vi.fn(),
  mockDbAll: vi.fn(),
}));

vi.mock('../services/agent_runner', () => ({
  run: mockRun,
  _activeRunCount: () => 0,
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    get isReady() { return true; },
    listMcp: vi.fn().mockResolvedValue({}),
    createSession: vi.fn().mockResolvedValue({ id: 'sdk-sess-1' }),
    promptAsync: vi.fn().mockResolvedValue(true),
    abortSession: vi.fn().mockResolvedValue(true),
    listMessages: vi.fn().mockResolvedValue([]),
  },
  opencodeSessionMap: new Map<string, string>(),
}));

vi.mock('../database/db', () => ({
  getDb: () => ({
    prepare: (sql: string) => ({
      get: () => mockDbGet(sql),
      all: () => mockDbAll(sql),
      run: vi.fn(),
    }),
  }),
  getPostgresPool: vi.fn(),
}));

vi.mock('../repositories/agent_scheduled_tasks_repository', () => ({
  AgentScheduledTasksRepository: class {
    findDueAsync = mockFindDueAsync;
    updateNextRunAsync = mockUpdateNextRunAsync;
  },
}));

vi.mock('../repositories/agent_scheduled_task_runs_repository', () => ({
  AgentScheduledTaskRunsRepository: class {
    create = mockCreateRun;
  },
}));

vi.mock('../repositories/agent_sessions_repository', () => ({
  AgentSessionsRepository: class {
    resetStaleRunning = mockResetStaleRunning;
    findMostRecentlyUsedModel = vi.fn().mockReturnValue(null);
  },
}));

import { startAgentSchedulerJob } from '../services/agentSchedulerService';
import { env } from '../config/env';

function makeDueTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-uuid-1',
    name: 'Memory Consolidation',
    description: null,
    prompt: 'Consolidate memories',
    allowedMcpsJson: null,
    allowedSkillsJson: null,
    modelProvider: null,
    modelId: null,
    scheduleType: 'daily',
    scheduledTime: '09:00',
    scheduledDay: null,
    cronExpression: null,
    runAt: null,
    timezone: 'America/Los_Angeles',
    nextRunAt: new Date(Date.now() - 60_000).toISOString(),
    agentKind: 'opencode',
    agentConfigId: 'profile-1',
    enabled: true,
    lastRunAt: null,
    lastRunStatus: null,
    lastError: null,
    createdByUserId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

async function dispatchOneTick(task: Record<string, unknown>): Promise<void> {
  mockFindDueAsync.mockResolvedValue([task]);
  const cronTask = startAgentSchedulerJob();
  cronTask?.stop();
  await new Promise<void>((resolve) => setTimeout(resolve, 100));
}

describe('Config Doctor D1/D2 — run history + honest terminal status', () => {
  let envSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateNextRunAsync.mockResolvedValue(undefined);
    mockCreateRun.mockResolvedValue(undefined);
    mockRun.mockResolvedValue({ sessionId: 'local-sess-1', result: 'ok', status: 'done' });
    envSpy = vi.spyOn(env, 'agentLocal', 'get').mockReturnValue(true);
    // Default: no pending approval, one mutating tool call → a clean success.
    mockDbGet.mockReturnValue(undefined);
    mockDbAll.mockReturnValue([{ tool: 'remember_memory' }]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.AGENT_LOCAL;
  });

  it('D1: writes a run-history row on task completion', async () => {
    await dispatchOneTick(makeDueTask());

    expect(mockCreateRun).toHaveBeenCalledOnce();
    const arg = mockCreateRun.mock.calls[0][0];
    expect(arg.taskId).toBe('task-uuid-1');
    expect(arg.status).toBe('success');
    expect(arg.rootSessionId).toBe('local-sess-1');
  });

  it('D2: a run with a pending approval at end reports blocked_on_approval, not success', async () => {
    mockDbGet.mockImplementation((sql: string) =>
      sql.includes('agent_approvals') ? { 1: 1 } : undefined,
    );

    await dispatchOneTick(makeDueTask());

    expect(mockUpdateNextRunAsync).toHaveBeenCalledWith(
      'task-uuid-1',
      expect.anything(),
      expect.anything(),
      'blocked_on_approval',
      undefined,
    );
    expect(mockCreateRun).toHaveBeenCalledOnce();
    expect(mockCreateRun.mock.calls[0][0].status).toBe('blocked_on_approval');
  });

  it('D2: a done run with zero mutating tool calls reports completed_no_op', async () => {
    mockDbAll.mockReturnValue([{ tool: 'list_memories' }, { tool: 'read_file' }]);

    await dispatchOneTick(makeDueTask());

    expect(mockUpdateNextRunAsync).toHaveBeenCalledWith(
      'task-uuid-1',
      expect.anything(),
      expect.anything(),
      'completed_no_op',
      undefined,
    );
    expect(mockCreateRun.mock.calls[0][0].status).toBe('completed_no_op');
  });
});
