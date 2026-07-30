/**
 * #1214 — Quarantine production scheduler state and prevent duplicate ticking.
 *
 * Root cause: `checkDueTasks()`'s only ownership signal was `env.agentLocal`
 * (which decides EXECUTION MECHANISM — direct AgentRunner.run() vs. inserting
 * a pending trigger — not whether ticking should happen at all). A hosted
 * Postgres-backed deployment (production; see AGENTS.md "Production is
 * Postgres") can end up ticking its own independent `agent_scheduled_tasks`
 * copy regardless of RHYTHM_ROLE/AGENT_LOCAL drift on that host — the
 * documented symptom in #1213/#1222 (a legacy 26-row Postgres collection with
 * a 100% failure rate, never reconciled with the local SQLite "owned" set).
 *
 * Fix: `env.dbClient` (already the established local-SQLite-vs-hosted-Postgres
 * signal used elsewhere in this exact file for `resetStaleRunning`/
 * `reapStuckSessions`) is now also the scheduler's OWNERSHIP gate — a
 * Postgres-backed process never advances or fires ANY due task, and logs one
 * actionable startup diagnostic if it finds enabled rows stranded there.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const {
  mockRun,
  mockFindDueAsync,
  mockUpdateNextRunAsync,
  mockListAllAsync,
  mockDbRun,
  mockResetStaleRunning,
} = vi.hoisted(() => ({
  mockRun: vi.fn(),
  mockFindDueAsync: vi.fn(),
  mockUpdateNextRunAsync: vi.fn().mockResolvedValue(undefined),
  mockListAllAsync: vi.fn().mockResolvedValue([]),
  mockDbRun: vi.fn(),
  mockResetStaleRunning: vi.fn().mockReturnValue(0),
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
  getDb: () => ({ prepare: () => ({ run: mockDbRun }) }),
  getPostgresPool: vi.fn(),
}));

vi.mock('../repositories/agent_scheduled_tasks_repository', () => ({
  AgentScheduledTasksRepository: class {
    findDueAsync = mockFindDueAsync;
    updateNextRunAsync = mockUpdateNextRunAsync;
    listAllAsync = mockListAllAsync;
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
import { logger } from '../utils/logger';

function makeDueTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-uuid-1',
    name: 'Legacy Postgres Task',
    description: null,
    prompt: 'Do something',
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
    agentConfigId: null,
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

describe('#1214 — a Postgres-backed (non-owner) deployment never ticks agent_scheduled_tasks', () => {
  let dbClientSpy: ReturnType<typeof vi.spyOn>;
  let agentLocalSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateNextRunAsync.mockResolvedValue(undefined);
    mockListAllAsync.mockResolvedValue([]);
    mockRun.mockResolvedValue({ sessionId: 'sdk-sess-1', result: 'ok', status: 'done' });
    warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.AGENT_LOCAL;
    delete process.env.DB_CLIENT;
  });

  it('dbClient=postgres, agentLocal=true (misconfigured host): does not advance or run a due task', async () => {
    dbClientSpy = vi.spyOn(env, 'dbClient', 'get').mockReturnValue('postgres');
    agentLocalSpy = vi.spyOn(env, 'agentLocal', 'get').mockReturnValue(true);
    mockFindDueAsync.mockResolvedValue([makeDueTask()]);

    const job = startAgentSchedulerJob();
    await new Promise<void>((resolve) => setTimeout(resolve, 100));

    expect(mockRun).not.toHaveBeenCalled();
    expect(mockFindDueAsync).not.toHaveBeenCalled();
    expect(mockUpdateNextRunAsync).not.toHaveBeenCalled();
    job?.stop();
  });

  it('dbClient=postgres, agentLocal=false (the documented production default): does not advance or enqueue a trigger', async () => {
    dbClientSpy = vi.spyOn(env, 'dbClient', 'get').mockReturnValue('postgres');
    agentLocalSpy = vi.spyOn(env, 'agentLocal', 'get').mockReturnValue(false);
    mockFindDueAsync.mockResolvedValue([makeDueTask()]);

    const job = startAgentSchedulerJob();
    await new Promise<void>((resolve) => setTimeout(resolve, 100));

    expect(mockRun).not.toHaveBeenCalled();
    expect(mockFindDueAsync).not.toHaveBeenCalled();
    expect(mockDbRun).not.toHaveBeenCalled();
    job?.stop();
  });

  it('returns a nullable stop handle (never a live CronTask) so the shutdown handler stays valid', async () => {
    dbClientSpy = vi.spyOn(env, 'dbClient', 'get').mockReturnValue('postgres');
    agentLocalSpy = vi.spyOn(env, 'agentLocal', 'get').mockReturnValue(false);

    const job = startAgentSchedulerJob();
    await new Promise<void>((resolve) => setTimeout(resolve, 20));

    expect(job).toBeNull();
  });

  it('logs one actionable startup diagnostic naming the count of stranded enabled rows', async () => {
    dbClientSpy = vi.spyOn(env, 'dbClient', 'get').mockReturnValue('postgres');
    agentLocalSpy = vi.spyOn(env, 'agentLocal', 'get').mockReturnValue(false);
    mockListAllAsync.mockResolvedValue([
      makeDueTask({ id: 'a', enabled: true }),
      makeDueTask({ id: 'b', enabled: true }),
      makeDueTask({ id: 'c', enabled: false }),
    ]);

    startAgentSchedulerJob();
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    const warned = warnSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
    expect(warned).toMatch(/2/); // 2 enabled rows, not 3 (disabled excluded)
    expect(warned.toLowerCase()).toMatch(/quarantine|never (run|tick|advance|fire)/);
  });

  it('does NOT log the quarantine diagnostic when no enabled rows are stranded', async () => {
    dbClientSpy = vi.spyOn(env, 'dbClient', 'get').mockReturnValue('postgres');
    agentLocalSpy = vi.spyOn(env, 'agentLocal', 'get').mockReturnValue(false);
    mockListAllAsync.mockResolvedValue([]);

    startAgentSchedulerJob();
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    const warned = warnSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
    expect(warned.toLowerCase()).not.toMatch(/quarantine/);
  });

  it('sqlite (local owner) is completely unaffected: still ticks normally', async () => {
    dbClientSpy = vi.spyOn(env, 'dbClient', 'get').mockReturnValue('sqlite');
    agentLocalSpy = vi.spyOn(env, 'agentLocal', 'get').mockReturnValue(true);
    mockFindDueAsync.mockResolvedValue([makeDueTask()]);

    const job = startAgentSchedulerJob();
    job?.stop();
    await new Promise<void>((resolve) => setTimeout(resolve, 100));

    expect(mockRun).toHaveBeenCalledOnce();
  });
});
