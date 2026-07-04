/**
 * CONTRACT TESTS — scheduler dispatch wiring for model-override (model override) and
 * scope-inherit (scope inheritance). Mirrors issue_739_scheduler_agent_runner.test.ts:
 * mock AgentRunner.run + the repository, drive the cron tick, and assert on the
 * options object the scheduler passes to AgentRunner.run.
 *
 * This is the load-bearing seam for BOTH issues:
 *   - model-c1: a task with model_provider+model_id → run() gets a matching modelOverride
 *   - model-c2: a task without them → run() gets NO modelOverride (runner falls back to profile)
 *   - scope-c1: a task with null allowed_mcps_json → run() gets allowedMcpsJson: undefined
 *             (so the runner INHERITS the profile; passing null would force "unrestricted")
 *   - scope-c3: a task with an explicit allowed_mcps_json → run() gets that value (override)
 *   - scope-c6: a task with allowed_skills_json → run() gets that value (skills override)
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
  mockFindDueAsync: vi.fn(),
  mockUpdateNextRunAsync: vi.fn().mockResolvedValue(undefined),
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
    name: 'Test Task',
    description: null,
    prompt: 'Do something useful',
    allowedMcpsJson: null as string | null,
    allowedSkillsJson: null as string | null,
    modelProvider: null as string | null,
    modelId: null as string | null,
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

/** Run one scheduler tick and return the options passed to AgentRunner.run. */
async function dispatchAndCaptureRunArg(task: Record<string, unknown>): Promise<Record<string, unknown>> {
  mockFindDueAsync.mockResolvedValue([task]);
  const cronTask = startAgentSchedulerJob();
  cronTask.stop();
  await new Promise<void>((resolve) => setTimeout(resolve, 100));
  expect(mockRun).toHaveBeenCalledOnce();
  return mockRun.mock.calls[0][0] as Record<string, unknown>;
}

describe('scheduler dispatch — per-task model override + profile scope inheritance', () => {
  let envSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateNextRunAsync.mockResolvedValue(undefined);
    mockRun.mockResolvedValue({ sessionId: 'sdk-sess-1', result: 'ok', status: 'done' });
    envSpy = vi.spyOn(env, 'agentLocal', 'get').mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.AGENT_LOCAL;
  });

  // Regression: scheduler ignores the task's model columns → the per-task
  // override never reaches the runner and the task is locked to the profile model.
  it('model-c1: task with model_provider+model_id → run() receives a matching modelOverride', async () => {
    const arg = await dispatchAndCaptureRunArg(
      makeDueTask({ modelProvider: 'anthropic', modelId: 'claude-opus-4-1' }),
    );
    expect(arg.modelOverride).toEqual({ providerID: 'anthropic', modelID: 'claude-opus-4-1' });
  });

  // Regression: scheduler invents a modelOverride for a task with no model
  // columns → the profile's resolveRunModel cascade is bypassed.
  it('model-c2: task without model columns → run() receives NO modelOverride', async () => {
    const arg = await dispatchAndCaptureRunArg(makeDueTask());
    expect(arg.modelOverride).toBeUndefined();
  });

  // Regression: scheduler passes null instead of undefined for an unscoped task
  // → resolveProfileScope reads null as an explicit "unrestricted" override and
  // the profile scope is NOT inherited.
  it('scope-c1: task with null allowed_mcps_json → run() receives allowedMcpsJson: undefined (inherit)', async () => {
    const arg = await dispatchAndCaptureRunArg(makeDueTask({ allowedMcpsJson: null }));
    expect(arg.allowedMcpsJson).toBeUndefined();
  });

  it('scope-c1b: task with an empty allowed_mcps_json array → run() receives undefined (inherit)', async () => {
    const arg = await dispatchAndCaptureRunArg(makeDueTask({ allowedMcpsJson: '[]' }));
    expect(arg.allowedMcpsJson).toBeUndefined();
  });

  // Regression: an explicit task allowlist stops overriding the profile.
  it('scope-c3: task with explicit allowed_mcps_json → run() receives that value (override)', async () => {
    const arg = await dispatchAndCaptureRunArg(makeDueTask({ allowedMcpsJson: JSON.stringify(['rhythm']) }));
    expect(arg.allowedMcpsJson).toBe(JSON.stringify(['rhythm']));
  });

  // Regression: the task's skill allowlist is never forwarded → a task can
  // never override the profile's skills.
  it('scope-c6: task with explicit allowed_skills_json → run() receives that value', async () => {
    const arg = await dispatchAndCaptureRunArg(makeDueTask({ allowedSkillsJson: JSON.stringify(['skill-a']) }));
    expect(arg.allowedSkillsJson).toBe(JSON.stringify(['skill-a']));
  });

  it('scope-c6b: task with null allowed_skills_json → run() receives allowedSkillsJson: undefined (inherit)', async () => {
    const arg = await dispatchAndCaptureRunArg(makeDueTask({ allowedSkillsJson: null }));
    expect(arg.allowedSkillsJson).toBeUndefined();
  });

  it('issue-0-c3: scheduler dispatches the bound profile', async () => {
    const arg = await dispatchAndCaptureRunArg(
      makeDueTask({
        agentKind: 'AI-Trend-Researcher',
        agentConfigId: 'AI-Trend-Researcher',
      }),
    );
    expect(arg.agentKind).toBe('AI-Trend-Researcher');
    expect(arg.agentConfigId).toBe('AI-Trend-Researcher');
  });

  it('issue-0-c4: scheduler preserves generic opencode dispatch', async () => {
    const arg = await dispatchAndCaptureRunArg(
      makeDueTask({
        agentKind: 'opencode',
        agentConfigId: null,
      }),
    );
    expect(arg.agentKind).toBe('opencode');
    expect(arg.agentConfigId).toBe('opencode');
  });
});
