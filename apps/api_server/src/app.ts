import cors from 'cors';
import express from 'express';

import { errorHandler } from './middleware/error_handler';
import { authRouter } from './routes/auth_routes';
import { healthRouter } from './routes/health_routes';
import { projectInstancesRouter } from './routes/project_instances_routes';
import { projectTemplatesRouter } from './routes/project_templates_routes';
import { recurringRulesRouter } from './routes/recurring_rules_routes';
import { tasksRouter } from './routes/tasks_routes';
import { weeklyPlanRouter } from './routes/weekly_plan_routes';

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.use('/health', healthRouter);
  app.use('/auth', authRouter);
  app.use('/tasks', tasksRouter);
  app.use('/project-templates', projectTemplatesRouter);
  app.use('/recurring-rules', recurringRulesRouter);
  app.use('/project-instances', projectInstancesRouter);
  app.use('/weekly-plan', weeklyPlanRouter);

  app.use(errorHandler);

  return app;
}
