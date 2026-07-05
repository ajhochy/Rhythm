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
import { googleBrokerRouter } from './routes/google_broker_routes';
import { pcoBrokerRouter } from './routes/pco_broker_routes';
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
import { agentDelegationRouter } from './routes/agent_delegation_routes';
import { agentSkillsRouter } from './routes/agentSkillsRoutes';
import { agentSessionsRouter } from './routes/agent_sessions_routes';
import { agentsCapabilitiesRouter } from './routes/agents_capabilities_routes';
import { usageBudgetRouter } from './routes/usage_budget_routes';
import { runQualityRouter } from './routes/run_quality_routes';
import { agentsModelsRouter } from './routes/agents_models_routes';
import { notificationsAgentRouter } from './routes/notifications_agent_routes';
import { opencodeAuthRouter } from './routes/opencode_auth_routes';
import { agentModelVisibilityRouter } from './routes/agent_model_visibility_routes';
import { opencodeModelsRouter } from './routes/opencode_models_routes';
import { opencodeMcpRouter } from './routes/opencode_mcp_routes';
import { opencodeSkillsRouter } from './routes/opencode_skills_routes';
import { opencodeSpilloverRouter } from './routes/opencode_spillover_routes';
import { syncRouter } from './routes/sync_routes';
import { ptyRouter } from './routes/pty_routes';
import { opencodeClient } from './services/opencode_engine';
import agentSchedulesRouter from './routes/agentSchedulesRoutes';
import agentMemoryRouter from './routes/agentMemoryRoutes';
import agentWebhookRouter from './routes/agentWebhookRoutes';
import agentResearchRouter from './routes/agentResearchRoutes';
import agentCookbookRouter from './routes/agentCookbookRoutes';
import orgProposalsRouter from './routes/org_proposals_routes';
import orgOptimizerRunRouter from './routes/org_optimizer_run_routes';
import agentDesignsRouter from './routes/agentDesignsRoutes';
import gmailSignalsRouter from './routes/gmail_signals_routes';
import { agentCapabilityStatusRouter } from './routes/agent_capability_status_routes';

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
  app.use('/dashboard', dashboardRouter);
  app.use('/auth', authRouter);
  app.use('/automation-catalog', automationCatalogRouter);
  app.use('/automation-rules', automationRulesRouter);
  app.use('/integrations/google', googleBrokerRouter);
  app.use('/integrations/planning-center/api', pcoBrokerRouter);
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
  // #755 — the agent-execution notifications surface must be mounted BEFORE the
  // always-on `/notifications` prefix (Express matches `/notifications` against
  // `/notifications/agent` otherwise). Gated like the rest of the agent
  // surfaces, but its registration order is pinned here.
  if (env.agentExecutionEnabled) {
    app.use('/notifications/agent', notificationsAgentRouter);
  }
  app.use('/notifications', notificationsRouter);
  app.use('/claude-triggers', claudeTriggersRouter);
  app.use('/integrations/gmail-signals', gmailSignalsRouter);
  app.use('/projects', projectsRouter);

  // ── Agent-execution surfaces (#755) ───────────────────────────────────────
  // Registered only when the deployment role enables the agent runtime
  // (RHYTHM_ROLE=all|local; the DEFAULT preserves today's behavior). The
  // 'cloud' (hosted production) role omits these so it never stands up agent
  // routes, the opencode proxy, the WS/sync fan-out, or the PTY bridge it
  // never uses. Core business + prod-owned trigger/notification surfaces above
  // are always registered. Gated at the registration site (not inside
  // handlers) so concurrent handler-owning issues (#736/#765/#737) are left
  // untouched.
  if (env.agentExecutionEnabled) {
    // NOTE: /agents/capabilities is unauthenticated for now; Phase 3.1 will add the AGENT_LOCAL bypass.
    app.use('/agents/capabilities', agentsCapabilitiesRouter);
    app.use('/agent-capability-status', agentCapabilityStatusRouter);
    app.use('/agents/usage-budget', usageBudgetRouter);
    app.use('/agents/run-quality', runQualityRouter);
    app.use('/agents/models', agentsModelsRouter);
    app.use('/agent-configs', agentConfigsRouter);
    app.use('/agent-delegation', agentDelegationRouter);
    app.use('/agent-skills', agentSkillsRouter);
    app.use('/agent-schedules', agentSchedulesRouter);
    // #807 (memory epic #801): /agent-memory is LOCAL-ONLY. It is registered
    // only inside this agent-execution gate, and its backing store is the
    // disposable SQLite index over the Obsidian Memory-Vault (served by the
    // local agent server on :4001). The cloud/prod agent_memory Postgres table
    // was removed (postgres_bootstrap.ts) — prod no longer creates or exposes a
    // memory store. Do NOT mount this router outside the gate or back it with
    // the production base.
    app.use('/agent-memory', agentMemoryRouter);
    app.use('/agent-webhooks', agentWebhookRouter);
    app.use('/agent-research', agentResearchRouter);
    app.use('/agent-cookbook', agentCookbookRouter);
    // org-optimizer-10 (#826): human-gate review queue — exception path for
    // new-agent + external-adoption/webhook-wiring proposals, plus an
    // audit-trail/rollback view of auto-applied ones (2026-07-02 policy).
    app.use('/agent-org-proposals', orgProposalsRouter);
    // org-optimizer-16 (#850): the live run-loop trigger — POST /agent-org-optimizer/run
    // executes the whole audit->generate->persist->auto-apply pass server-side.
    app.use('/agent-org-optimizer', orgOptimizerRunRouter);
    app.use('/agent-designs', agentDesignsRouter);
    app.use('/agent-sessions', agentSessionsRouter);
    app.use(ptyRouter);
    app.use('/sync', syncRouter);

    // Opencode engine auth & health
    app.use('/opencode/auth', opencodeAuthRouter);
    // Issue #609 — OpenRouter / opencode model catalog browse (server-side proxy)
    app.use('/opencode/models', opencodeModelsRouter);
    // OPC-M4-3 — MCP server management (list, add, connect, disconnect, remove)
    app.use('/opencode/mcp', opencodeMcpRouter);
    // Unify-2 — skills source of truth: live fork skills + Rhythm-managed writes
    app.use('/opencode/skills', opencodeSkillsRouter);
    // Task D (dual Anthropic accounts) — rate-limit spillover intake from the
    // vendored engine plugin (POST http://localhost:4001/opencode/spillover).
    app.use('/opencode/spillover', opencodeSpilloverRouter);
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
    app.get('/opencode/commands', async (_req, res) => {
      try {
        const commands = await opencodeClient.listCommands();
        res.json(commands);
      } catch {
        res.json([]);
      }
    });
    app.get('/opencode/health', (_req, res) => {
      res.json({
        status: opencodeClient.isReady ? 'ready' : 'unavailable',
        message: opencodeClient.statusMessage,
      });
    });
  }

  app.use(errorHandler);

  return app;
}
