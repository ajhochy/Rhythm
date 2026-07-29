/**
 * Live behavioral regression for scheduled-task capacity handling.
 *
 * No service is mocked. The real scheduler dispatches a due task through the
 * real AgentRunner and the test asserts the persisted outcome an API/UI caller
 * observes. Opt in with RHYTHM_LIVE_E2E=1 and AGENT_LOCAL=true.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { env } from '../../config/env';
import { getDb, setDb } from '../../database/db';
import { runMigrations } from '../../database/migrations';
import { AgentScheduledTasksRepository } from '../../repositories/agent_scheduled_tasks_repository';
import { startAgentSchedulerJob } from '../agentSchedulerService';

const liveEnabled = process.env.RHYTHM_LIVE_E2E === '1';

describe.skipIf(!liveEnabled)('live scheduler capacity behavior', () => {
  const repo = new AgentScheduledTasksRepository();
  let db: Database.Database;

  beforeAll(() => {
    expect(env.agentLocal).toBe(true);
    process.env.MAX_CONCURRENT_AGENT_RUNS = '0';
    db = new Database(':memory:');
    setDb(db);
    runMigrations(db);
  });

  afterAll(() => {
    delete process.env.MAX_CONCURRENT_AGENT_RUNS;
    db.close();
  });

  it('persists a capacity-blocked task as queued for the next scheduler tick', async () => {
    const task = await repo.createAsync({
      name: 'Live capacity retry',
      scheduleType: 'daily',
      scheduledTime: '23:59',
      timezone: 'America/Los_Angeles',
      nextRunAt: new Date(Date.now() - 60_000).toISOString(),
      prompt: 'This prompt must not reach the engine while capacity is zero.',
      agentKind: 'opencode',
    });

    const dispatchedAt = Date.now();
    const scheduler = startAgentSchedulerJob();
    scheduler?.stop();

    let observed = await repo.findByIdAsync(task.id);
    const deadline = Date.now() + 2_000;
    while (observed?.lastRunStatus !== 'queued' && Date.now() < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      observed = await repo.findByIdAsync(task.id);
    }

    expect(observed?.lastRunStatus).toBe('queued');
    expect(observed?.lastError).toMatch(/concurrency cap/i);
    const retryAt = Date.parse(observed?.nextRunAt ?? '');
    expect(retryAt).toBeGreaterThanOrEqual(dispatchedAt + 59_000);
    expect(retryAt).toBeLessThanOrEqual(Date.now() + 61_000);
  });
});
