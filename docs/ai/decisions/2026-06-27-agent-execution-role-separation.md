---
tags: [decision, rhythm]
date: 2026-06-27
issues: [755]
status: implemented
---

# Agent-execution role separation (`RHYTHM_ROLE`)

## Context

Surfaced during the 2026-06-27 prod outage fix (#754). The single `rhythm-api`
image runs **all** agent-execution machinery in every deployment with no
gating:

- Agent routes are mounted unconditionally in `apps/api_server/src/app.ts`
  (`/agent-sessions`, `/agent-configs`, `/agent-schedules`, `/agent-memory`,
  `/agent-webhooks`, `/agent-research`, `/agent-cookbook`, `/agent-designs`,
  `/agent-delegation`, `/agent-skills`, `/agents/*`, `/opencode/*`,
  `/agent-models/visibility`, the PTY router, and `/sync`/notifications-agent).
- `AgentScheduler` starts unconditionally — `server.ts` calls
  `startAgentSchedulerJob()` (confirmed ticking on prod:
  `[AgentScheduler] Scheduler started (1-min tick)`).
- Opencode SDK init (`opencodeClient.initialize()`), the plugin-config writer,
  managed Chrome, the agent-stack skill seed, the WS gateway
  (`attachWsGateway`), and the memory-consolidation seed all run
  unconditionally in `server.ts`. On prod these fail harmlessly
  (`spawn opencode ENOENT`) but still attempt init every boot.
- The Postgres bootstrap (`postgres_bootstrap.ts`) creates agent
  session/config/scheduler tables on **every** postgres deployment.

There is **no deployment-role concept** in `config/env.ts` — only `DB_CLIENT`
(sqlite/postgres) and `AGENT_LOCAL` (an auth bypass).

**Prod-owned surfaces that must keep working** (NOT agent-execution): the
trigger queue `pending_claude_triggers` and its routes (`/claude-triggers`),
plus the cloud-scheduled-task table `agent_scheduled_tasks` (the cloud role
still needs to enqueue/own scheduled triggers; only the *execution* of those
triggers happens locally).

## Decision

Introduce a deployment-role flag in `config/env.ts`:

```
RHYTHM_ROLE = all | cloud | local      (default: all)
```

- **`all`** (DEFAULT) — preserves today's behavior exactly: every agent surface
  registered and initialized. This is the no-regression default; nothing
  changes for an unset env. Chosen as default because the *embedded* api_server
  inside the Flutter app does not set any role env today and must keep running
  the full agent runtime.
- **`local`** — the local agent server (localhost:4001, SQLite). Identical to
  `all` for agent surfaces. Exists so a future local deployment can opt in
  explicitly; behaves like `all`.
- **`cloud`** — the hosted production API. Agent-**execution** surfaces are
  NOT registered or initialized. Prod-owned data surfaces stay.

Derived booleans on `env`:

- `env.role: 'all' | 'cloud' | 'local'`
- `env.agentExecutionEnabled: boolean` — `true` for `all`/`local`, `false` for
  `cloud`. This is the single switch every gate reads, so the policy lives in
  one place.

Unknown `RHYTHM_ROLE` values throw at startup (same posture as `DB_CLIENT`),
so a typo can't silently disable agent execution.

### Surfaces gated by `agentExecutionEnabled === false` (cloud role)

`app.ts` (route registration — gated at the registration site, not inside
handlers, to avoid touching files owned by concurrent sibling issues
#736/#765/#737):

- `/agents/capabilities`, `/agents/usage-budget`, `/agents/models`
- `/agent-configs`, `/agent-delegation`, `/agent-skills`, `/agent-schedules`,
  `/agent-memory`, `/agent-webhooks`, `/agent-research`, `/agent-cookbook`,
  `/agent-designs`, `/agent-sessions`
- `/agent-models/visibility`
- `/notifications/agent`
- the PTY router (`ptyRouter`)
- `/opencode/auth`, `/opencode/models`, `/opencode/mcp`, `/opencode/commands`,
  `/opencode/health`, `/opencode/providers`
- `/sync` (SyncEvent fan-out is part of the agent/opencode surface)
- `/integrations/gmail-signals` stays (gmail signals feed prod automations) —
  see "Explicitly NOT gated".

`server.ts` (startup init):

- `startAgentSchedulerJob()` — NOT started in cloud role.
- `agentMemoryService.seedConsolidationTask()` — skipped.
- agent-stack skill seed block — skipped.
- `attachWsGateway(httpServer)` — skipped (a no-op WSS is still created so the
  shutdown handler `wss.close()` stays valid).
- `ensureRequiredPlugins()` — skipped.
- managed Chrome (`managedChromeService.ensureReady()`) — skipped.
- `opencodeClient.initialize()` and the Claude auto-bridge — skipped.

`postgres_bootstrap.ts` (DDL):

- The agent session/config/execution tables and their ALTERs are wrapped so
  they are created ONLY when `agentExecutionEnabled` is true:
  `agent_memory`, `agent_webhook_endpoints`, `agent_research_jobs`,
  `agent_cookbook`, `agent_designs`, `agent_skills`, `agent_skill_versions`,
  and the `agent_configs` / `agent_sessions` ALTERs (those base tables are
  SQLite-only via `migrations.ts`, so the ALTERs were already dead/erroring on
  postgres — gating them is also a latent-bug fix).
- KEPT unconditionally on every postgres deploy (prod-owned):
  `pending_claude_triggers` (+ its scheduler-context ALTER columns and index)
  and `agent_scheduled_tasks` (+ index). The cloud role still owns the trigger
  queue and the scheduled-task records; only their execution moves local.

### Composition with `AGENT_LOCAL`

`AGENT_LOCAL` is unchanged and orthogonal: it is the localhost auth-bypass flag
for agent endpoints. `RHYTHM_ROLE` decides *whether the surfaces exist*;
`AGENT_LOCAL` decides *whether auth is bypassed on them when they do*. The
embedded local server sets `AGENT_LOCAL=true` and leaves `RHYTHM_ROLE` unset
(→ `all`), so it keeps full agent execution with the auth bypass exactly as
today. Cloud sets `RHYTHM_ROLE=cloud` and never sets `AGENT_LOCAL`.

### Explicitly NOT gated

- `/health`, all core business routes (tasks, projects, rhythms, messages,
  facilities, users, dashboard, automation, integrations, weekly-plan,
  workspaces, notifications, auth, brokers).
- `/claude-triggers` (prod-owned trigger queue).
- `/integrations/gmail-signals` (feeds prod automation, not agent execution).
- `pending_claude_triggers` and `agent_scheduled_tasks` DDL.

## Alternatives considered

1. **Per-handler guards** (return 503 inside each agent route) — rejected:
   touches handler files owned by concurrent sibling issues, and still pays the
   opencode/scheduler init cost. Gating at registration + startup is cleaner.
2. **Default `cloud`** — rejected: would regress the embedded local server,
   which sets no role env. Default must be `all`.
3. **Separate deployment images / infra split** — out of scope for this issue;
   a single image switched by one env var satisfies the acceptance criteria
   without an infra change.

## Consequences

- Production (`RHYTHM_ROLE=cloud`) boots with no `spawn opencode ENOENT`, no
  scheduler tick, no WS gateway, and creates no agent session/config tables.
- The embedded local server (no role env) and any explicit `local` deploy
  behave exactly as today.
- One new env var to document in deployment configs. Cloud compose/helm must
  set `RHYTHM_ROLE=cloud`; everything else inherits the safe `all` default.
- The latent postgres ALTER-without-CREATE on `agent_configs`/`agent_sessions`
  is now only attempted in non-cloud postgres deployments (none exist today),
  removing a class of bootstrap errors from prod.
