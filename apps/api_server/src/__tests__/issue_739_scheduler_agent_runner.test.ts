/**
 * #739 — Scheduler wiring: AgentRunner vs insertScheduledTrigger
 *
 * When AGENT_LOCAL=true, a due task must call AgentRunner.run() and must NOT
 * call insertScheduledTrigger (no double-run).
 *
 * When AGENT_LOCAL is unset/false, a due task must call insertScheduledTrigger
 * and must NOT call AgentRunner.run().
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Hoist mock fns so factories can reference them ────────────────────────────

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

// ── Mock modules ──────────────────────────────────────────────────────────────

vi.mock('../services/agent_runner', () => ({
  run: mockRun,
  _activeRunCount: () => 0,
  resolveRunModel: () => ({ providerID: 'openrouter', modelID: 'anthropic/claude-sonnet-4.6' }),
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
  getDb: () => ({
    prepare: () => ({ run: mockDbRun }),
  }),
  getPostgresPool: vi.fn(),
}));

vi.mock('../repositories/agent_scheduled_tasks_repository', () => ({
  AgentScheduledTasksRepository: class {
    findDueAsync = mockFindDueAsync;
    updateNextRunAsync = mockUpdateNextRunAsync;
  },
}));

// #738-fix: mock AgentSessionsRepository so the stale-run reset on boot
// does not touch mockDbRun, keeping the trigger-INSERT assertions clean.
vi.mock('../repositories/agent_sessions_repository', () => ({
  AgentSessionsRepository: class {
    resetStaleRunning = mockResetStaleRunning;
    findMostRecentlyUsedModel = vi.fn().mockReturnValue(null);
  },
}));

// ── Import scheduler after mocks ──────────────────────────────────────────────

import { startAgentSchedulerJob } from '../services/agentSchedulerService';
import { env } from '../config/env';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Minimal due task row */
function makeDueTask(overrides: Partial<{
  id: string; name: string; prompt: string; allowedMcpsJson: string | null;
}> = {}) {
  return {
    id: overrides.id ?? 'task-uuid-1',
    name: overrides.name ?? 'Test Task',
    prompt: overrides.prompt ?? 'Do something useful',
    allowedMcpsJson: overrides.allowedMcpsJson ?? null,
    allowedSkillsJson: null,
    scheduleType: 'daily',
    scheduledTime: '09:00',
    scheduledDay: null,
    cronExpression: null,
    runAt: null,
    timezone: 'America/Los_Angeles',
    nextRunAt: new Date(Date.now() - 60_000).toISOString(),
    agentKind: 'opencode',
    enabled: true,
    lastRunAt: null,
    lastRunStatus: null,
    lastError: null,
    createdByUserId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe('#739 — Scheduler AgentRunner wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateNextRunAsync.mockResolvedValue(undefined);
    mockRun.mockResolvedValue({ sessionId: 'sdk-sess-1', result: 'ok', status: 'done' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.AGENT_LOCAL;
  });

  // ── A. AGENT_LOCAL=true → use AgentRunner, not insertScheduledTrigger ──────

  it('with AGENT_LOCAL=true: calls AgentRunner.run for a due task', async () => {
    // Patch env.agentLocal for this test
    const envSpy = vi.spyOn(env, 'agentLocal', 'get').mockReturnValue(true);

    mockFindDueAsync.mockResolvedValue([makeDueTask()]);

    const task = startAgentSchedulerJob();
    task.stop();

    // Give async chain time to resolve
    await new Promise<void>((resolve) => setTimeout(resolve, 100));

    expect(mockRun).toHaveBeenCalledOnce();
    expect(mockRun).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'Do something useful',
      outputTarget: 'session',
    }));
    // DB trigger INSERT must NOT have been called (no insertScheduledTrigger)
    expect(mockDbRun).not.toHaveBeenCalled();

    envSpy.mockRestore();
  });

  // ── B. AGENT_LOCAL false → use insertScheduledTrigger, not AgentRunner ─────

  it('with AGENT_LOCAL=false: calls insertScheduledTrigger and does NOT call AgentRunner.run', async () => {
    const envSpy = vi.spyOn(env, 'agentLocal', 'get').mockReturnValue(false);

    mockFindDueAsync.mockResolvedValue([makeDueTask()]);

    const task = startAgentSchedulerJob();
    task.stop();

    await new Promise<void>((resolve) => setTimeout(resolve, 100));

    // AgentRunner.run must NOT have been called
    expect(mockRun).not.toHaveBeenCalled();
    // DB INSERT should have been called (trigger insertion)
    expect(mockDbRun).toHaveBeenCalled();

    envSpy.mockRestore();
  });

  // ── C. One task failure does not break the loop ───────────────────────────

  it('with AGENT_LOCAL=true: one failing task does not prevent others from running', async () => {
    const envSpy = vi.spyOn(env, 'agentLocal', 'get').mockReturnValue(true);

    const task1 = makeDueTask({ id: 'task-1', name: 'Task 1', prompt: 'Prompt 1' });
    const task2 = makeDueTask({ id: 'task-2', name: 'Task 2', prompt: 'Prompt 2' });

    mockFindDueAsync.mockResolvedValue([task1, task2]);

    // Both calls succeed (the AgentRunner is called fire-and-forget)
    mockRun
      .mockRejectedValueOnce(new Error('Task 1 exploded'))
      .mockResolvedValueOnce({ sessionId: 'sess-2', result: 'ok', status: 'done' });

    const cronTask = startAgentSchedulerJob();
    cronTask.stop();

    await new Promise<void>((resolve) => setTimeout(resolve, 100));

    // Both tasks should have been dispatched to AgentRunner
    expect(mockRun).toHaveBeenCalledTimes(2);

    envSpy.mockRestore();
  });

  // ── D. No tasks → no calls ────────────────────────────────────────────────

  it('does not call AgentRunner or insertScheduledTrigger when no tasks are due', async () => {
    const envSpy = vi.spyOn(env, 'agentLocal', 'get').mockReturnValue(true);

    mockFindDueAsync.mockResolvedValue([]);

    const cronTask = startAgentSchedulerJob();
    cronTask.stop();

    await new Promise<void>((resolve) => setTimeout(resolve, 100));

    expect(mockRun).not.toHaveBeenCalled();
    expect(mockDbRun).not.toHaveBeenCalled();

    envSpy.mockRestore();
  });
});
