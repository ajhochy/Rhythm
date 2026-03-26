import cron from 'node-cron';
import { SyncOrchestratorService } from '../services/sync_orchestrator_service';
import { logger } from '../utils/logger';

const DEFAULT_SYNC_CRON_SCHEDULE = '*/30 * * * *'; // Every 30 minutes

function getSyncCronSchedule(): string {
  return process.env.SYNC_CRON_SCHEDULE ?? DEFAULT_SYNC_CRON_SCHEDULE;
}

export function startSyncOrchestratorJob(): void {
  const schedule = getSyncCronSchedule();

  cron.schedule(schedule, () => {
    logger.info('SyncOrchestrator: running scheduled sync');
    const orchestrator = new SyncOrchestratorService();
    void orchestrator.runSync();
  });

  logger.info(`SyncOrchestrator: scheduled with cron "${schedule}"`);
}
