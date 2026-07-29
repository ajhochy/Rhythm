/**
 * #1222 (Problem 2 — startup catch-up burst).
 *
 * `startAgentSchedulerJob()` fires its FIRST `checkDueTasks()` pass
 * synchronously at boot, but `opencodeClient.initialize()` is kicked off
 * separately and later in server.ts's startup sequence (a non-blocking
 * `.then()` chain). Any task due at boot used to reach `AgentRunner.run()` ->
 * `createSession()` while the engine client was still null, failing
 * instantly and permanently — the observed "N schedules all errored at the
 * identical timestamp" symptom.
 *
 * The scheduler now waits (bounded) for `opencodeClient.isReady` before its
 * boot-time pass ONLY — the regular 1-minute cron tick is untouched, and the
 * trigger-insertion path (env.agentLocal === false) never waits since it
 * doesn't touch the engine at all.
 *
 * NOTE: this wait deliberately lives in agentSchedulerService.ts, not inside
 * the shared AgentRunner.run() path — an earlier version of this fix put it
 * there, which meant EVERY caller of run() (interactive delegation, cookbook
 * runs, etc.) would wait up to the bound whenever the engine legitimately
 * never becomes ready (including every unit test that doesn't mock
 * opencode_engine, several of which broke with a 15s+ timeout). Scoping the
 * wait to the one call site that actually races boot avoids that collateral
 * cost entirely.
 *
 * Uses a MUTABLE `isReady` mock (docs/ai/testing-guide.md "Mocking the
 * Opencode engine in tests") so readiness can flip mid-test.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const {
  mockRun,
  mockFindDueAsync,
  mockUpdateNextRunAsync,
  mockDbRun,
  mockResetStaleRunning,
} = vi.hoisted(() => ({
  mockRun: vi.fn(),
  mockFindDueAsync: vi.fn().mockResolvedValue([]),
  mockUpdateNextRunAsync: vi.fn().mockResolvedValue(undefined),
  mockDbRun: vi.fn(),
  mockResetStaleRunning: vi.fn().mockReturnValue(0),
}));

vi.mock('../services/agent_runner', () => ({
  run: mockRun,
  _activeRunCount: () => 0,
  // resolveProfileScope (agent_profile_scope.ts, used by the trigger-insertion
  // path below) imports resolveRunModel from this module.
  resolveRunModel: vi.fn().mockReturnValue({ providerID: 'anthropic', modelID: 'claude-sonnet-4-6' }),
}));

vi.mock('../services/opencode_engine', () => {
  let _ready = false;
  return {
    opencodeClient: {
      get isReady() {
        return _ready;
      },
      set isReady(v: boolean) {
        _ready = v;
      },
    },
    opencodeSessionMap: new Map<string, string>(),
  };
});

vi.mock('../database/db', () => ({
  getDb: () => ({ prepare: () => ({ run: mockDbRun }) }),
  getPostgresPool: vi.fn(),
}));

vi.mock('../repositories/agent_scheduled_tasks_repository', () => ({
  AgentScheduledTasksRepository: class {
    findDueAsync = mockFindDueAsync;
    updateNextRunAsync = mockUpdateNextRunAsync;
    listAllAsync = vi.fn().mockResolvedValue([]);
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
import { opencodeClient } from '../services/opencode_engine';

function makeDueTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-uuid-1',
    name: 'Boot Catch-up Task',
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

describe('#1222 — scheduler boot-time pass waits for engine readiness', () => {
  let dbClientSpy: ReturnType<typeof vi.spyOn>;
  let agentLocalSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateNextRunAsync.mockResolvedValue(undefined);
    mockRun.mockResolvedValue({ sessionId: 'sdk-sess-1', result: 'ok', status: 'done' });
    dbClientSpy = vi.spyOn(env, 'dbClient', 'get').mockReturnValue('sqlite');
    (opencodeClient as unknown as { isReady: boolean }).isReady = false;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.AGENT_SCHEDULER_BOOT_ENGINE_WAIT_MS;
  });

  it('agentLocal=true: does not run the boot-time due task until isReady flips true', async () => {
    agentLocalSpy = vi.spyOn(env, 'agentLocal', 'get').mockReturnValue(true);
    mockFindDueAsync.mockResolvedValue([makeDueTask()]);

    const job = startAgentSchedulerJob();

    // Shortly after boot, the engine is not ready yet — must NOT have run.
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    expect(mockRun).not.toHaveBeenCalled();

    // Simulate opencodeClient.initialize() completing.
    (opencodeClient as unknown as { isReady: boolean }).isReady = true;

    // Now the bounded poll should pick it up and proceed.
    await new Promise<void>((resolve) => setTimeout(resolve, 700));
    expect(mockRun).toHaveBeenCalledOnce();

    job?.stop();
  }, 10_000);

  it('agentLocal=true, engine already ready at boot: runs promptly (no regression for the common case)', async () => {
    agentLocalSpy = vi.spyOn(env, 'agentLocal', 'get').mockReturnValue(true);
    (opencodeClient as unknown as { isReady: boolean }).isReady = true;
    mockFindDueAsync.mockResolvedValue([makeDueTask()]);

    const job = startAgentSchedulerJob();
    await new Promise<void>((resolve) => setTimeout(resolve, 150));

    expect(mockRun).toHaveBeenCalledOnce();
    job?.stop();
  });

  it('agentLocal=true: still proceeds (letting AgentRunner report its own error) if the engine never becomes ready', async () => {
    process.env.AGENT_SCHEDULER_BOOT_ENGINE_WAIT_MS = '200';
    agentLocalSpy = vi.spyOn(env, 'agentLocal', 'get').mockReturnValue(true);
    mockFindDueAsync.mockResolvedValue([makeDueTask()]);
    // isReady stays false for the whole test — engine never comes up.

    const job = startAgentSchedulerJob();
    await new Promise<void>((resolve) => setTimeout(resolve, 500));

    expect(mockRun).toHaveBeenCalledOnce();
    job?.stop();
  }, 10_000);

  it('agentLocal=false (trigger-insertion path): never waits on engine readiness at all', async () => {
    agentLocalSpy = vi.spyOn(env, 'agentLocal', 'get').mockReturnValue(false);
    mockFindDueAsync.mockResolvedValue([makeDueTask()]);
    // isReady stays false — must be irrelevant to this path.

    const job = startAgentSchedulerJob();
    await new Promise<void>((resolve) => setTimeout(resolve, 100));

    expect(mockRun).not.toHaveBeenCalled();
    expect(mockDbRun).toHaveBeenCalled();
    job?.stop();
  });
});
