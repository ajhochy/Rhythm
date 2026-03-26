import { createApp } from './app';
import { initDb } from './database/db';
import { startRecurrenceGenerationJob } from './jobs/recurrence_generation_job';
import { startSyncOrchestratorJob } from './jobs/sync_orchestrator_job';
import { logger } from './utils/logger';

const port = Number(process.env.PORT ?? 4000);

initDb();
logger.info('Database initialized');

startRecurrenceGenerationJob();
startSyncOrchestratorJob();

const app = createApp();

app.listen(port, () => {
  logger.info(`Rhythm API listening on port ${port}`);
});
