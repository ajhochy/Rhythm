import cors from 'cors';
import express, { type Router } from 'express';

import { env } from './config/env';
import { errorHandler } from './middleware/error_handler';
import { localAgentSurfaceGuard } from './middleware/local_agent_surface_guard';
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
import { orgSkillsRouter } from './routes/org_skills_routes';
import { orgSettingsRouter } from './routes/org_settings_routes';
import { autoPromotionSettingsRouter } from './routes/auto_promotion_settings_routes';
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
import { runOutcomeRouter } from './routes/run_outcome_routes';
import { agentsModelsRouter } from './routes/agents_models_routes';
import { notificationsAgentRouter } from './routes/notifications_agent_routes';
import { opencodeAuthRouter } from './routes/opencode_auth_routes';
import { agentModelVisibilityRouter } from './routes/agent_model_visibility_routes';
import { opencodeModelsRouter } from './routes/opencode_models_routes';
import { opencodeMcpRouter } from './routes/opencode_mcp_routes';
import { opencodeSkillsRouter } from './routes/opencode_skills_routes';
import { opencodeCommandsRouter } from './routes/opencode_commands_routes';
import { opencodeWorktreesRouter } from './routes/opencode_worktrees_routes';
import { opencodeSpilloverRouter } from './routes/opencode_spillover_routes';
import { syncRouter } from './routes/sync_routes';
import { ptyRouter } from './routes/pty_routes';
import { createRelayGatewayRouter } from './routes/relay_gateway_routes';
import { opencodeClient } from './services/opencode_engine';
import { streamBridge } from './services/opencode_stream_bridge';
import { buildOpencodeHealthPayload } from './services/opencode_health';
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
import { agentApprovalsRouter } from './routes/agent_approvals_routes';
import { systemRouter } from './routes/system_routes';
import { engraphManagerRouter } from './routes/engraph_manager_routes';
import { createMobileGatewayRouter } from './routes/mobile_gateway_routes';
import { agentActivityRouter } from './routes/agent_activity_routes';
import { creativePlatformRouter } from './routes/creative_platform_routes';
import { setupReadinessRouter } from './routes/setup_readiness_routes';
import { liveArtifactsRouter } from './routes/live_artifacts_routes';
import { devLogsRouter } from './routes/dev_logs_routes';
import { goalsRouter } from './routes/goals_routes';
import { mediaArtifactsRouter } from './routes/media_artifacts_routes';
import {
  sharedTranscriptsRouter,
  transcriptShareCreationRouter,
} from './routes/shared_transcripts_routes';

export function createApp(options: { mobileGatewayRouter?: Router } = {}) {
  const app = express();

  app.use(localAgentSurfaceGuard);
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) {
          callback(null, true);
          return;
        }

        if (
          env.agentOriginGuardEnabled === false &&
          env.corsAllowedOrigins.length === 0
        ) {
          callback(null, true);
          return;
        }

        if (
          env.agentOriginGuardEnabled !== false &&
          env.agentLocal
        ) {
          callback(null, env.localRendererOrigins.includes(origin));
          return;
        }

        if (
          env.agentOriginGuardEnabled !== false &&
          env.corsAllowedOrigins.length === 0
        ) {
          callback(null, false);
          return;
        }

        if (env.corsAllowedOrigins.includes(origin)) {
          callback(null, true);
          return;
        }

        callback(new Error(`Origin ${origin} is not allowed by CORS`));
      },
      allowedHeaders: ['Content-Type', 'Authorization', 'content-type', 'X-Signature-SHA256', 'Range', 'X-Rhythm-Project', 'X-Rhythm-Project-ID', 'X-Rhythm-Auto-Promotion-Confirmation'],
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
  app.use('/goals', goalsRouter);
  app.use('/project-templates', projectTemplatesRouter);
  app.use('/recurring-rules', recurringRulesRouter);
  app.use('/project-instances', projectInstancesRouter);
  app.use('/weekly-plan', weeklyPlanRouter);
  app.use('/users', usersRouter);
  app.use('/message-threads', messagesRouter);
  app.use('/facilities', facilitiesRouter);
  app.use('/workspaces', workspaceRouter);
  app.use('/live-artifacts', liveArtifactsRouter);
  app.use('/artifacts', mediaArtifactsRouter);
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
  // #1053 (OCU-12) — the org's shared skill library. Always-on (NOT gated by
  // agentExecutionEnabled): the 'cloud' deployment role IS the production API
  // this is hosted on, and that role has agentExecutionEnabled=false. Reads
  // (index.json, files/:name/:file) are public by design; writes require
  // requireAuth (see org_skills_routes.ts).
  app.use('/org-skills', orgSkillsRouter);
  // #1072 (OCU-31) — the org's single instructions markdown. Same
  // always-on-in-production posture as /org-skills above (GET is public,
  // PUT requires requireAuth — see org_settings_routes.ts).
  app.use('/org-settings', orgSettingsRouter);
  // #1178 — privacy-reviewed transcript snapshots are an authenticated,
  // always-on production API surface. They persist in Postgres in the hosted
  // cloud role and must not depend on the local OpenCode runtime being enabled.
  app.use(transcriptShareCreationRouter);
  app.use('/shares', sharedTranscriptsRouter);

  // ── Relay surface (docs/ai/plan-synology-relay.md) ────────────────────────
  // Only the Synology relay container mounts this; every other role 404s
  // /relay/*. Deliberately OUTSIDE the agentExecutionEnabled block — the
  // relay role has agentExecutionEnabled=false but still serves phones.
  if (env.isRelayRole) {
    app.use('/relay', createRelayGatewayRouter());
  }

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
    app.use('/dev', devLogsRouter);
    app.use(
      '/mobile-gateway',
      options.mobileGatewayRouter ?? createMobileGatewayRouter(),
    );
    // NOTE: /agents/capabilities is unauthenticated for now; Phase 3.1 will add the AGENT_LOCAL bypass.
    app.use('/agents/capabilities', agentsCapabilitiesRouter);
    app.use('/agent-capability-status', agentCapabilityStatusRouter);
    app.use('/creative-platform', creativePlatformRouter);
    app.use('/setup-readiness', setupReadinessRouter);
    app.use('/agent-approvals', agentApprovalsRouter);
    app.use('/agents/usage-budget', usageBudgetRouter);
    app.use('/agents/run-quality', runQualityRouter);
    // W4 — the immutable run-outcome ledger + its append-only feedback API.
    // Same agent-execution gate as its sibling agent routes: the hosted 'cloud'
    // role never runs agents, so it has no run outcomes to serve.
    app.use('/agent-run-outcomes', runOutcomeRouter);
    app.use('/agents/models', agentsModelsRouter);
    app.use('/agent-configs', agentConfigsRouter);
    app.use('/agent-delegation', agentDelegationRouter);
    app.use('/agent-skills', agentSkillsRouter);
    app.use('/agent-schedules', agentSchedulesRouter);
    // #807 (memory epic #801): /agent-memory is LOCAL-ONLY. It is registered
    // only inside this agent-execution gate, and its backing store is the
    // disposable index over the Obsidian Memory-Vault (served by the local
    // agent server on :4001). #1219 restores role-gated Postgres schema parity
    // for agent-execution deployments, but does not expose this router outside
    // the execution gate or change the vault's canonical authority.
    app.use('/agent-memory', agentMemoryRouter);
    // #1096 WP1 — device-local Engraph backend manager status/action API.
    // Standalone prefix (not nested under /agent-memory) so it never risks
    // colliding with that router's `/:id` catch-all route.
    app.use('/engraph-manager', engraphManagerRouter);
    app.use('/agent-webhooks', agentWebhookRouter);
    app.use('/agent-research', agentResearchRouter);
    app.use('/agent-cookbook', agentCookbookRouter);
    app.use('/agent-activity', agentActivityRouter);
    // org-optimizer-10 (#826): human-gate review queue — exception path for
    // new-agent + external-adoption/webhook-wiring proposals, plus an
    // audit-trail/rollback view of auto-applied ones (2026-07-02 policy).
    app.use('/agent-org-proposals', orgProposalsRouter);
    // org-optimizer-16 (#850): the live run-loop trigger — POST /agent-org-optimizer/run
    // executes the whole audit->generate->persist->auto-apply pass server-side.
    app.use('/agent-org-optimizer', orgOptimizerRunRouter);
    // D4.4: authenticated local desktop Settings state and explicit opt-in.
    app.use('/optimizer', autoPromotionSettingsRouter);
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
    // OCU-16 (#1057) — worktree lifecycle (list/create/remove/reset).
    app.use('/opencode/worktrees', opencodeWorktreesRouter);
    // Task D (dual Anthropic accounts) — rate-limit spillover intake from the
    // vendored engine plugin (POST http://localhost:4001/opencode/spillover).
    app.use('/opencode/spillover', opencodeSpilloverRouter);
    // Issue #609 — agent model visibility CRUD
    app.use('/agent-models/visibility', agentModelVisibilityRouter);
    // #948 — hot-reload config caches (skills) without an agent-server restart.
    // Mounted inside the agent-execution gate: the opencode engine it reloads
    // only exists when the agent runtime is stood up.
    app.use('/system', systemRouter);

    // M5-2: custom provider definitions placeholder. Returns 501 until the
    // SDK config writer is wired through `opencode_plugin_config.ts`.
    app.put('/opencode/providers', (_req, res) => {
      res.status(501).json({
        error: 'NOT_IMPLEMENTED',
        message:
          'Custom provider definitions are not yet wired through opencode_plugin_config.ts. Edit opencode.json directly for now.',
      });
    });

    // OCU-09 (#1050) — Playbooks: custom slash-command CRUD (list/content/
    // create/edit/delete) writing managed `commands/*.md` + config reload.
    // Supersedes the earlier inline GET-only route (its list shape is preserved
    // by the router's GET /).
    app.use('/opencode/commands', opencodeCommandsRouter);

    // M5-1 (Providers tab) / M4-3 — legacy inline list retained under a distinct
    // path so nothing that consumed the old GET shape breaks (kept minimal).
    app.get('/opencode/commands-legacy', async (_req, res) => {
      try {
        const commands = await opencodeClient.listCommands();
        res.json(commands);
      } catch {
        res.json([]);
      }
    });
    app.get('/opencode/health', (_req, res) => {
      res.json(buildOpencodeHealthPayload(opencodeClient, streamBridge));
    });
  }

  app.use(errorHandler);

  return app;
}
