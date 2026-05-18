import cors from 'cors';
import express from 'express';

import { env } from './config/env';
import { errorHandler } from './middleware/error_handler';
import { authRouter } from './routes/auth_routes';
import { automationCatalogRouter } from './routes/automation_catalog_routes';
import { automationRulesRouter } from './routes/automation_rules_routes';
import { facilitiesRouter } from './routes/facilities_routes';
import { dashboardRouter } from './routes/dashboard_routes';
import { healthRouter } from './routes/health_routes';
import { integrationsRouter } from './routes/integrations_routes';
import { messagesRouter } from './routes/messages_routes';
import { projectInstancesRouter } from './routes/project_instances_routes';
import { projectTemplatesRouter } from './routes/project_templates_routes';
import { projectsRouter } from './routes/projects_routes';
import { recurringRulesRouter } from './routes/recurring_rules_routes';
import { tasksRouter } from './routes/tasks_routes';
import { usersRouter } from './routes/users_routes';
import { weeklyPlanRouter } from './routes/weekly_plan_routes';
import { workspaceRouter } from './routes/workspace_routes';
import { notificationsRouter } from './routes/notifications_routes';
import claudeTriggersRouter from './routes/claude_triggers_routes';
import { agentConfigsRouter } from './routes/agent_configs_routes';
import { agentSessionsRouter } from './routes/agent_sessions_routes';
import { agentsCapabilitiesRouter } from './routes/agents_capabilities_routes';
import { agentsModelsRouter } from './routes/agents_models_routes';
import { notificationsAgentRouter } from './routes/notifications_agent_routes';
import { opencodeAuthRouter } from './routes/opencode_auth_routes';
import { agentModelVisibilityRouter } from './routes/agent_model_visibility_routes';
import { opencodeModelsRouter } from './routes/opencode_models_routes';
import { opencodeClient } from './services/opencode_engine';

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
  // Allow larger bodies for OAuth token exchange and session creation.
  // The OpenAI OAuth access token alone can exceed 4 KB; the default 100 KB
  // limit is sufficient for normal requests but we raise it to 1 MB as a
  // safety margin.
  app.use(express.json({ limit: '1mb' }));

  app.use('/health', healthRouter);
  // NOTE: /agents/capabilities is unauthenticated for now; Phase 3.1 will add the AGENT_LOCAL bypass.
  app.use('/agents/capabilities', agentsCapabilitiesRouter);
  app.use('/agents/models', agentsModelsRouter);
  app.use('/dashboard', dashboardRouter);
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
  app.use('/notifications/agent', notificationsAgentRouter);
  app.use('/notifications', notificationsRouter);
  app.use('/claude-triggers', claudeTriggersRouter);
  app.use('/agent-configs', agentConfigsRouter);
  app.use('/agent-sessions', agentSessionsRouter);
  app.use('/projects', projectsRouter);

  // Opencode engine auth & health
  app.use('/opencode/auth', opencodeAuthRouter);
  // Issue #609 — OpenRouter / opencode model catalog browse (server-side proxy)
  app.use('/opencode/models', opencodeModelsRouter);
  // Issue #609 — agent model visibility CRUD
  app.use('/agent-models/visibility', agentModelVisibilityRouter);

  // M5-2: custom provider definitions placeholder. Returns 501 until the
  // SDK config writer is wired through `opencode_plugin_config.ts`.
  app.put('/opencode/providers', (_req, res) => {
    res.status(501).json({
      error: 'NOT_IMPLEMENTED',
      message:
        'Custom provider definitions are not yet wired through opencode_plugin_config.ts. Edit opencode.json directly for now.',
    });
  });

  // M5-1 (Providers tab) / M4-3 — list user-defined commands from the SDK.
  // Returns [] until the SDK exposes client.command.list end-to-end so the
  // Flutter popover renders an empty state instead of throwing.
  app.get('/opencode/commands', (_req, res) => {
    res.json([]);
  });
  app.get('/opencode/health', (_req, res) => {
    res.json({
      status: opencodeClient.isReady ? 'ready' : 'unavailable',
      message: opencodeClient.statusMessage,
    });
  });

  app.use(errorHandler);

  return app;
}
