import cron, { type ScheduledTask } from 'node-cron';
import { SyncOrchestratorService } from '../services/sync_orchestrator_service';
import { logger } from '../utils/logger';

// Tightened from */30 to */10 to reduce the window in which production tasks
// created after the last sync are invisible to the agent server (issue #620).
const DEFAULT_SYNC_CRON_SCHEDULE = '*/10 * * * *'; // Every 10 minutes

function getSyncCronSchedule(): string {
  return process.env.SYNC_CRON_SCHEDULE ?? DEFAULT_SYNC_CRON_SCHEDULE;
}

export function startSyncOrchestratorJob(): ScheduledTask {
  const schedule = getSyncCronSchedule();

  const task = cron.schedule(schedule, () => {
    logger.info('SyncOrchestrator: running scheduled sync');
    const orchestrator = new SyncOrchestratorService();
    void orchestrator.runSync();
  });

  logger.info(`SyncOrchestrator: scheduled with cron "${schedule}"`);
  return task;
}
