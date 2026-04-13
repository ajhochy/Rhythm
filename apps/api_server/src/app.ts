import cors from 'cors';
import express from 'express';

import { env } from './config/env';
import { errorHandler } from './middleware/error_handler';
import { authRouter } from './routes/auth_routes';
import { automationCatalogRouter } from './routes/automation_catalog_routes';
import { automationRulesRouter } from './routes/automation_rules_routes';
import { facilitiesRouter } from './routes/facilities_routes';
import { healthRouter } from './routes/health_routes';
import { integrationsRouter } from './routes/integrations_routes';
import { messagesRouter } from './routes/messages_routes';
import { projectInstancesRouter } from './routes/project_instances_routes';
import { projectTemplatesRouter } from './routes/project_templates_routes';
import { recurringRulesRouter } from './routes/recurring_rules_routes';
import { tasksRouter } from './routes/tasks_routes';
import { usersRouter } from './routes/users_routes';
import { weeklyPlanRouter } from './routes/weekly_plan_routes';
import { workspaceRouter } from './routes/workspace_routes';

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || env.corsAllowedOrigins.length === 0) {
          callback(null, true);
          return;
        }

        if (env.corsAllowedOrigins.includes(origin)) {
          callback(null, true);
          return;
        }

        callback(new Error(`Origin ${origin} is not allowed by CORS`));
      },
    }),
  );
  app.use(express.json());

  app.use('/health', healthRouter);
  app.use('/auth', authRouter);
  app.use('/automation-catalog', automationCatalogRouter);
  app.use('/automation-rules', automationRulesRouter);
  app.use('/integrations', integrationsRouter);
  app.use('/tasks', tasksRouter);
  app.use('/project-templates', projectTemplatesRouter);
  app.use('/recurring-rules', recurringRulesRouter);
  app.use('/project-instances', projectInstancesRouter);
  app.use('/weekly-plan', weeklyPlanRouter);
  app.use('/users', usersRouter);
  app.use('/message-threads', messagesRouter);
  app.use('/facilities', facilitiesRouter);
  app.use('/workspaces', workspaceRouter);

  app.use(errorHandler);

  return app;
}
