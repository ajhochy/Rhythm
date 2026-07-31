/**
 * R3 contract: a process-up OpenCode client is not sufficient readiness for a
 * scheduled run. A successful engine round-trip is required before any run
 * session is created.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockRun,
  mockFindDueAsync,
  mockUpdateNextRunAsync,
  mockListAllAsync,
  mockResetStaleRunning,
  mockListMcp,
} = vi.hoisted(() => ({
  mockRun: vi.fn(),
  mockFindDueAsync: vi.fn(),
  mockUpdateNextRunAsync: vi.fn().mockResolvedValue(undefined),
  mockListAllAsync: vi.fn().mockResolvedValue([]),
  mockResetStaleRunning: vi.fn().mockReturnValue(0),
  mockListMcp: vi.fn(),
}));

let processReady = true;

vi.mock('../services/agent_runner', () => ({
  run: mockRun,
  _activeRunCount: () => 0,
  resolveRunModel: () => ({
    providerID: 'anthropic',
    modelID: 'claude-sonnet-4-6',
  }),
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    get isReady() {
      return processReady;
    },
    listMcp: mockListMcp,
  },
  opencodeSessionMap: new Map<string, string>(),
}));

vi.mock('../database/db', () => ({
  getDb: () => ({ prepare: () => ({ run: vi.fn() }) }),
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
    reapStuckSessions = vi.fn().mockReturnValue(0);
    findMostRecentlyUsedModel = vi.fn().mockReturnValue(null);
  },
}));

import * as Scheduler from '../services/agentSchedulerService';
import { env } from '../config/env';

function makeDueTask() {
  return {
    id: 'r3-task-1',
    name: 'R3 readiness task',
    description: null,
    prompt: 'Do not run until the engine accepts work.',
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
  };
}

async function flushScheduler(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 50));
}

describe('R3 scheduled engine readiness gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    processReady = true;
    mockFindDueAsync.mockResolvedValue([]);
    mockListAllAsync.mockResolvedValue([]);
    mockListMcp.mockResolvedValue({});
    mockRun.mockResolvedValue({
      sessionId: 'session-1',
      result: 'ok',
      status: 'done',
    });
    mockUpdateNextRunAsync.mockResolvedValue(undefined);
    mockResetStaleRunning.mockReturnValue(0);
    vi.spyOn(env, 'dbClient', 'get').mockReturnValue('sqlite');
    vi.spyOn(env, 'agentLocal', 'get').mockReturnValue(true);
    process.env.AGENT_SCHEDULER_BOOT_ENGINE_WAIT_MS = '0';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.AGENT_SCHEDULER_BOOT_ENGINE_WAIT_MS;
  });

  it('r3-c1: process-up without a successful readiness round-trip defers exactly once and creates no session', async () => {
    mockFindDueAsync.mockResolvedValue([makeDueTask()]);
    mockListMcp.mockRejectedValue(new Error('engine socket is accepting connections but not session work'));

    const job = Scheduler.startAgentSchedulerJob();
    job?.stop();
    await flushScheduler();

    expect(mockRun).not.toHaveBeenCalled();
    expect(mockUpdateNextRunAsync).toHaveBeenCalledOnce();
    expect(mockUpdateNextRunAsync).toHaveBeenCalledWith(
      'r3-task-1',
      expect.any(String),
      expect.any(String),
      'queued',
      expect.stringMatching(/engine_not_ready/i),
    );
  });

  it('r3-c2: readiness wait uses the injected clock and sleep until a real probe succeeds', async () => {
    const waitForScheduledEngineReady = (
      Scheduler as unknown as {
        waitForScheduledEngineReady?: (deps: {
          timeoutMs: number;
          pollIntervalMs: number;
          now: () => number;
          sleep: (ms: number) => Promise<void>;
          probe: () => Promise<boolean>;
        }) => Promise<boolean>;
      }
    ).waitForScheduledEngineReady;

    expect(
      typeof waitForScheduledEngineReady,
      'scheduler must export the injectable readiness wait',
    ).toBe('function');
    if (!waitForScheduledEngineReady) return;

    let nowMs = 0;
    const sleep = vi.fn(async (ms: number) => {
      nowMs += ms;
    });
    const probe = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const ready = await waitForScheduledEngineReady({
      timeoutMs: 1_000,
      pollIntervalMs: 250,
      now: () => nowMs,
      sleep,
      probe,
    });

    expect(ready).toBe(true);
    expect(probe).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(nowMs).toBe(500);
  });

  it('r3-c6: restart recovery writes one categorized interruption result and dispatches no replacement run', async () => {
    mockResetStaleRunning.mockReturnValue(2);

    const job = Scheduler.startAgentSchedulerJob();
    job?.stop();
    await flushScheduler();

    expect(mockResetStaleRunning).toHaveBeenCalledOnce();
    expect(mockResetStaleRunning).toHaveBeenCalledWith(
      expect.stringMatching(/restart_interruption.*server restarted.*run interrupted/i),
    );
    expect(mockRun).not.toHaveBeenCalled();
  });
});
