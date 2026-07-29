import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { env } from '../../config/env';
import { setDb } from '../../database/db';
import { runMigrations } from '../../database/migrations';
import { AgentScheduledTasksRepository } from '../../repositories/agent_scheduled_tasks_repository';
import { startAgentSchedulerJob } from '../agentSchedulerService';

const liveEnabled = process.env.RHYTHM_LIVE_E2E === '1';
const TZ = 'America/Los_Angeles';

describe.skipIf(!liveEnabled)('live scheduler cron timezone behavior (#1089)', () => {
  const repo = new AgentScheduledTasksRepository();
  let db: Database.Database;
  let previousAgentLocal: boolean;

  beforeAll(() => {
    previousAgentLocal = env.agentLocal;
    (env as { agentLocal: boolean }).agentLocal = false;
    db = new Database(':memory:');
    setDb(db);
    runMigrations(db);
  });

  afterAll(() => {
    (env as { agentLocal: boolean }).agentLocal = previousAgentLocal;
    db.close();
  });

  it('persists the next cron recurrence at 6:30 AM Pacific wall-clock', async () => {
    const now = new Date();
    const task = await repo.createAsync({
      name: 'Live cron timezone check',
      scheduleType: 'cron',
      cronExpression: '30 6 * * 1-5',
      timezone: TZ,
      nextRunAt: new Date(now.getTime() - 60_000).toISOString(),
      prompt: 'Issue 1089 live cron timezone check.',
      agentKind: 'opencode',
    });

    const scheduler = startAgentSchedulerJob();
    scheduler?.stop();

    let observed = await repo.findByIdAsync(task.id);
    const deadline = Date.now() + 3_000;
    while (
      (observed?.nextRunAt == null || Date.parse(observed.nextRunAt) <= now.getTime()) &&
      Date.now() < deadline
    ) {
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
      observed = await repo.findByIdAsync(task.id);
    }

    expect(observed?.nextRunAt).toBeTruthy();

    const wall = new Intl.DateTimeFormat('en-US', {
      timeZone: TZ,
      hourCycle: 'h23',
      hour: 'numeric',
      minute: 'numeric',
    }).format(new Date(observed!.nextRunAt!));

    expect(wall).toBe('06:30');
  });
});
