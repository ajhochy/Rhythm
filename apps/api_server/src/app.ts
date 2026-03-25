import cors from 'cors';
import express from 'express';

import { authRouter } from './routes/auth_routes';
import { healthRouter } from './routes/health_routes';

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.use('/health', healthRouter);
  app.use('/auth', authRouter);

  return app;
}
