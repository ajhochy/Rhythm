import { createApp } from './app';
import { initDb } from './database/db';
import { logger } from './utils/logger';

const port = Number(process.env.PORT ?? 4000);

initDb();
logger.info('Database initialized');

const app = createApp();

app.listen(port, () => {
  logger.info(`Rhythm API listening on port ${port}`);
});
