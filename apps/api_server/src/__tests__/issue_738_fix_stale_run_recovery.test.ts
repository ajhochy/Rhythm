/**
 * #738-fix — Scheduler boot resets stale 'running' sessions to 'error'
 *
 * When the server restarts, any agent_sessions row left in status='running'
 * (from a prior crash/abort) must be reset to 'error' by startAgentSchedulerJob.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Hoist mock fns ────────────────────────────────────────────────────────────

const {
  mockResetStaleRunning,
  mockFindDueAsync,
  mockUpdateNextRunAsync,
  mockListAllAsync,
  mockAgentRun,
  mockDbRun,
} = vi.hoisted(() => ({
  mockResetStaleRunning: vi.fn().mockReturnValue(2),
  mockFindDueAsync: vi.fn().mockResolvedValue([]),
  mockUpdateNextRunAsync: vi.fn().mockResolvedValue(undefined),
  // #1214 — startAgentSchedulerJob's Postgres-ownership guard calls
  // listAllAsync() to log the quarantine diagnostic; default to no rows.
  mockListAllAsync: vi.fn().mockResolvedValue([]),
  mockAgentRun: vi.fn().mockResolvedValue({ sessionId: 's', result: '', status: 'done' }),
  mockDbRun: vi.fn(),
}));

vi.mock('../repositories/agent_sessions_repository', () => ({
  AgentSessionsRepository: class {
    insert = vi.fn().mockReturnValue({ id: 'sess-1', status: 'starting' });
    findMostRecentlyUsedModel = vi.fn().mockReturnValue(null);
    resetStaleRunning = mockResetStaleRunning;
  },
}));

vi.mock('../repositories/agent_scheduled_tasks_repository', () => ({
  AgentScheduledTasksRepository: class {
    findDueAsync = mockFindDueAsync;
    updateNextRunAsync = mockUpdateNextRunAsync;
    listAllAsync = mockListAllAsync;
  },
}));

vi.mock('../services/agent_runner', () => ({
  run: mockAgentRun,
  resolveRunModel: vi.fn().mockReturnValue({ providerID: 'anthropic', modelID: 'claude-sonnet-4-5' }),
  _activeRunCount: () => 0,
}));

vi.mock('../database/db', () => ({
  getDb: () => ({ prepare: () => ({ run: mockDbRun }) }),
  getPostgresPool: vi.fn(),
}));

// ── Import subject after mocks ────────────────────────────────────────────────

import { startAgentSchedulerJob } from '../services/agentSchedulerService';
import { env } from '../config/env';

describe('#738-fix — scheduler stale-run recovery on boot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindDueAsync.mockResolvedValue([]);
    mockListAllAsync.mockResolvedValue([]);
    mockResetStaleRunning.mockReturnValue(2);
  });

  it('calls resetStaleRunning("Server restarted…") on SQLite scheduler start', async () => {
    // env.dbClient is 'sqlite' by default in test env
    const dbClientSpy = vi.spyOn(env, 'dbClient' as never, 'get').mockReturnValue('sqlite' as never);

    const task = startAgentSchedulerJob();
    task?.stop();
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    expect(mockResetStaleRunning).toHaveBeenCalledWith('Server restarted — run interrupted');
    dbClientSpy.mockRestore();
  });

  it('does NOT call resetStaleRunning on Postgres scheduler start (agent_sessions is SQLite-only)', async () => {
    const dbClientSpy = vi.spyOn(env, 'dbClient' as never, 'get').mockReturnValue('postgres' as never);

    const task = startAgentSchedulerJob();
    task?.stop();
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    expect(mockResetStaleRunning).not.toHaveBeenCalled();
    dbClientSpy.mockRestore();
  });
});
