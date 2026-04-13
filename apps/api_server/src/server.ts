import path from 'path';
import { config as loadDotenv } from 'dotenv';

// Load .env from the api_server root (one level above dist/).
// CI writes OAuth secrets here before bundling into the .app.
loadDotenv({ path: path.join(__dirname, '..', '.env') });

async function main() {
  const [{ createApp }, { initDb }, { startRecurrenceGenerationJob }, { startSyncOrchestratorJob }, { logger }] =
    await Promise.all([
      import('./app'),
      import('./database/db'),
      import('./jobs/recurrence_generation_job'),
      import('./jobs/sync_orchestrator_job'),
      import('./utils/logger'),
    ]);

  const port = Number(process.env.PORT ?? 4000);

  await initDb();
  logger.info('Database initialized');

  startRecurrenceGenerationJob();
  startSyncOrchestratorJob();

  const app = createApp();

  app.listen(port, () => {
    logger.info(`Rhythm API listening on port ${port}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
