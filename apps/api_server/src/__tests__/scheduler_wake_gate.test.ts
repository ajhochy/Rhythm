/**
 * Wake gate + staleness contract.
 *
 * macOS wakes a lid-closed laptop for ~45s DarkWake windows. A scheduler tick
 * inside one of those windows dispatched a run that froze mid-tool-call when the
 * machine went back to sleep, and the run's wall-clock inactivity timer killed
 * it. Two confirmed failures (2026-09-18, 2026-09-21) ended to the second on the
 * next DarkWake event.
 *
 * Contract:
 *  1. Nothing dispatches while the machine is asleep / dark-waking, and nothing
 *     is advanced or lost — the due rows stay exactly as they were.
 *  2. On wake, a missed run that is still inside its own period fires EXACTLY
 *     ONCE, however many periods were slept through.
 *  3. A missed run whose own next occurrence has also passed does NOT fire, and
 *     leaves a visible `skipped_stale` record rather than disappearing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockRun,
  mockFindDueAsync,
  mockUpdateNextRunAsync,
  mockListAllAsync,
  mockResetStaleRunning,
  mockResetStaleRunningAsync,
  mockReapStuckSessions,
  mockCreateRun,
  mockListMcp,
  mockExecFile,
} = vi.hoisted(() => ({
  mockRun: vi.fn().mockResolvedValue({ status: 'done', sessionId: 'ses_1' }),
  mockFindDueAsync: vi.fn().mockResolvedValue([]),
  mockUpdateNextRunAsync: vi.fn().mockResolvedValue(undefined),
  mockListAllAsync: vi.fn().mockResolvedValue([]),
  mockResetStaleRunning: vi.fn().mockReturnValue(0),
  mockResetStaleRunningAsync: vi.fn().mockResolvedValue(0),
  mockReapStuckSessions: vi.fn().mockReturnValue(0),
  mockCreateRun: vi.fn().mockResolvedValue(undefined),
  mockListMcp: vi.fn().mockResolvedValue({}),
  mockExecFile: vi.fn(),
}));

// Partial mock: only `execFile` is swapped. Other services in the import graph
// (engraph_manager) reach for `spawn` at module load and must keep the real one.
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  execFile: mockExecFile,
}));

vi.mock('../services/agent_runner', () => ({
  run: mockRun,
  _activeRunCount: () => 0,
  resolveRunModel: () => ({ providerID: 'anthropic', modelID: 'claude-sonnet-4-6' }),
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: { get isReady() { return true; }, listMcp: mockListMcp },
  opencodeSessionMap: new Map<string, string>(),
}));

vi.mock('../database/db', () => ({
  getDb: () => ({ prepare: () => ({ run: vi.fn(), get: () => undefined, all: () => [] }) }),
  getPostgresPool: vi.fn(),
}));

vi.mock('../repositories/agent_scheduled_tasks_repository', () => ({
  AgentScheduledTasksRepository: class {
    findDueAsync = mockFindDueAsync;
    updateNextRunAsync = mockUpdateNextRunAsync;
    listAllAsync = mockListAllAsync;
    resetStaleRunningAsync = mockResetStaleRunningAsync;
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
    reapStuckSessions = mockReapStuckSessions;
  },
}));

vi.mock('../services/post_apply_lifecycle', () => ({
  sweepPostApplyLifecycleAsync: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../config/env', () => ({
  env: { agentLocal: true, dbClient: 'sqlite', researchProjectsEnabled: false },
}));

/** `promisify(execFile)` calls the callback form; mimic pmset's stdout. */
function pmsetReturns(userIsActive: 0 | 1): void {
  mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
    cb(null, { stdout: `Assertion status system-wide:\n   BackgroundTask                 0\n   UserIsActive                   ${userIsActive}\n`, stderr: '' });
  });
}

const DAILY_TASK = {
  id: 'task_daily',
  name: 'daily-dev-summary',
  scheduleType: 'daily',
  scheduledTime: '06:00',
  scheduledDay: null,
  cronExpression: null,
  runAt: null,
  timezone: 'America/Los_Angeles',
  prompt: 'summarize',
  agentKind: 'claude-code',
  agentConfigId: null,
  modelProvider: null,
  modelId: null,
  allowedMcpsJson: null,
  allowedSkillsJson: null,
  createdByUserId: 1,
  lastError: null,
};

describe('scheduler wake gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRun.mockResolvedValue({ status: 'done', sessionId: 'ses_1' });
    mockListMcp.mockResolvedValue({});
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    // vitest.setup.ts pins the gate open so the rest of the suite does not
    // depend on this Mac's display state. This file is the one that must
    // actually exercise it, so it opts back in and drives `pmset` via the mock.
    delete process.env.AGENT_SCHEDULER_IGNORE_POWER_STATE;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
  });

  it('dispatches nothing and advances nothing while the Mac is asleep', async () => {
    pmsetReturns(0); // DarkWake / asleep
    // Due 20 minutes ago — well within its daily period, so not stale.
    mockFindDueAsync.mockResolvedValue([
      { ...DAILY_TASK, nextRunAt: new Date(Date.now() - 20 * 60_000).toISOString() },
    ]);

    const { startAgentSchedulerJob } = await import('../services/agentSchedulerService');
    const job = startAgentSchedulerJob();
    await job!.boot;
    job!.stop();

    expect(mockRun).not.toHaveBeenCalled();
    // Critically: next_run_at untouched, so the task stays due for the next tick.
    expect(mockUpdateNextRunAsync).not.toHaveBeenCalled();
    expect(mockCreateRun).not.toHaveBeenCalled();
  });

  it('fires a slept-through run exactly once when the Mac wakes', async () => {
    pmsetReturns(1); // awake, user present
    mockFindDueAsync.mockResolvedValue([
      { ...DAILY_TASK, nextRunAt: new Date(Date.now() - 20 * 60_000).toISOString() },
    ]);

    const { startAgentSchedulerJob } = await import('../services/agentSchedulerService');
    const job = startAgentSchedulerJob();
    await job!.boot;
    job!.stop();

    expect(mockRun).toHaveBeenCalledTimes(1);
  });

  it('coalesces a week of missed one-off-per-day occurrences into a single run', async () => {
    pmsetReturns(1);
    // findDueAsync returns ONE row per task however far overdue; a `once`
    // schedule is deliberately never treated as stale, so this proves the
    // coalescing without the staleness rule masking it.
    mockFindDueAsync.mockResolvedValue([
      {
        ...DAILY_TASK,
        scheduleType: 'once',
        scheduledTime: null,
        runAt: new Date(Date.now() - 7 * 86_400_000).toISOString(),
        nextRunAt: new Date(Date.now() - 7 * 86_400_000).toISOString(),
      },
    ]);

    const { startAgentSchedulerJob } = await import('../services/agentSchedulerService');
    const job = startAgentSchedulerJob();
    await job!.boot;
    job!.stop();

    expect(mockRun).toHaveBeenCalledTimes(1);
  });

  it('skips a missed run whose own next occurrence has also passed, visibly', async () => {
    pmsetReturns(1);
    // Due two days ago: the following daily occurrence has long since passed.
    mockFindDueAsync.mockResolvedValue([
      { ...DAILY_TASK, nextRunAt: new Date(Date.now() - 2 * 86_400_000).toISOString() },
    ]);

    const { startAgentSchedulerJob } = await import('../services/agentSchedulerService');
    const job = startAgentSchedulerJob();
    await job!.boot;
    job!.stop();

    expect(mockRun).not.toHaveBeenCalled();

    // Visible, not silent: schedule advanced + status stamped + history row.
    expect(mockUpdateNextRunAsync).toHaveBeenCalledTimes(1);
    const [taskId, nextRun, , status, note] = mockUpdateNextRunAsync.mock.calls[0];
    expect(taskId).toBe('task_daily');
    expect(status).toBe('skipped_stale');
    expect(note).toMatch(/asleep/i);
    expect(new Date(nextRun as string).getTime()).toBeGreaterThan(Date.now());

    expect(mockCreateRun).toHaveBeenCalledTimes(1);
    expect(mockCreateRun.mock.calls[0][0]).toMatchObject({
      taskId: 'task_daily',
      status: 'skipped_stale',
    });
  });

  it('fails open when the power probe errors, and on non-macOS hosts', async () => {
    const { isMachineAwake } = await import('../services/agentSchedulerService');

    await expect(
      isMachineAwake({ platform: 'linux', readAssertions: async () => 'UserIsActive 0' }),
    ).resolves.toBe(true);

    await expect(
      isMachineAwake({
        platform: 'darwin',
        readAssertions: async () => { throw new Error('pmset exploded'); },
      }),
    ).resolves.toBe(true);
  });
});

describe('isMissedRunStale', () => {
  const base = {
    scheduledDay: null,
    cronExpression: null,
    runAt: null,
    timezone: 'America/Los_Angeles',
  };

  it('is false inside the schedule period, true once it has lapsed', async () => {
    const { isMissedRunStale } = await import('../services/agentSchedulerService');
    const now = new Date('2026-09-21T16:00:00.000Z'); // 09:00 PDT

    // Missed today's 06:00 PDT slot, three hours ago — tomorrow's has not passed.
    expect(
      isMissedRunStale(
        { ...base, scheduleType: 'daily', scheduledTime: '06:00', nextRunAt: '2026-09-21T13:00:00.000Z' },
        now,
      ),
    ).toBe(false);

    // Missed a slot two days back — the following occurrence is long gone.
    expect(
      isMissedRunStale(
        { ...base, scheduleType: 'daily', scheduledTime: '06:00', nextRunAt: '2026-09-19T13:00:00.000Z' },
        now,
      ),
    ).toBe(true);
  });

  it('never treats a one-off as stale', async () => {
    const { isMissedRunStale } = await import('../services/agentSchedulerService');
    expect(
      isMissedRunStale(
        {
          ...base,
          scheduleType: 'once',
          scheduledTime: null,
          runAt: '2026-08-01T13:00:00.000Z',
          nextRunAt: '2026-08-01T13:00:00.000Z',
        },
        new Date('2026-09-21T16:00:00.000Z'),
      ),
    ).toBe(false);
  });

  it('fails open on an unparseable schedule', async () => {
    const { isMissedRunStale } = await import('../services/agentSchedulerService');
    expect(
      isMissedRunStale(
        { ...base, scheduleType: 'cron', scheduledTime: null, cronExpression: 'not a cron', nextRunAt: '2026-01-01T00:00:00.000Z' },
        new Date('2026-09-21T16:00:00.000Z'),
      ),
    ).toBe(false);
  });
});
