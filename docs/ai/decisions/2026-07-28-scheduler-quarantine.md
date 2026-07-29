---
date: 2026-07-28
repo: Rhythm
tags: [decision, rhythm]
index: "[[Rhythm]]"
---

# Scheduler ownership is decided by DB_CLIENT, not RHYTHM_ROLE/AGENT_LOCAL

## Context

#1213 found the four scheduler MCP tools (`rhythm_create_scheduled_task`,
`rhythm_list_scheduled_tasks`, `rhythm_cancel_scheduled_task`,
`rhythm_trigger_now`) routed at `RHYTHM_API_URL` (production) instead of
`RHYTHM_AGENT_URL` (local). #1222 found the hosted production API holds an
independent, 26-row `agent_scheduled_tasks` collection with a 100% failure
rate — every row has `created_by_user_id: null` and every run fails instantly
with the generic "AgentRunner: failed to create opencode session", even on a
warm engine 47 minutes into uptime (not a cold-start race).

Tracing the code: `agentSchedulerService.checkDueTasks()`'s only branch point
is `env.agentLocal` — true calls `AgentRunner.run()` directly, false inserts a
row into `pending_claude_triggers`. Neither branch is gated by deployment
role or datastore. The existing `env.agentExecutionEnabled` gate (`#755`,
`RHYTHM_ROLE`) already disables the scheduler's cron entirely for the
explicit `cloud` role — but the hosted deployment's own
`.env.production.example` template never sets `RHYTHM_ROLE` (defaults to
`all`) and the `DeploymentRole` comment explicitly documented `all` as
"the current single prod image ... keeps working with no env change" — i.e.
production was, by original design, assumed to run WITH agent execution
enabled. The instant, 100%-reproducible, warm-engine failure is consistent
with `AgentRunner.run()` executing directly on that host against an
`OpencodeClientService` whose `this.client` never successfully initializes
there (no real local `claude`/`codex` CLI, no interactive auth) — i.e. the
hosted API has likely been ticking and directly executing this legacy row set
via the exact `agentLocal` branch that should never run outside the local
desktop agent server.

## Decision

Gate scheduler ticking on `env.dbClient` instead of (or in addition to)
`RHYTHM_ROLE`/`AGENT_LOCAL`:

- `startAgentSchedulerJob()` returns immediately (no cron scheduled, no
  immediate catch-up `checkDueTasks()` call) whenever `env.dbClient ===
  'postgres'`. This is the same signal already used in this exact file for
  `resetStaleRunning`/`reapStuckSessions`, and matches AGENTS.md's own
  "Production is Postgres" framing — it is a more reliable ownership signal
  than `AGENT_LOCAL`, which can drift/be misconfigured on a given host
  (as the observed symptom implies happened here).
- Before returning, it lists all rows and logs ONE actionable startup
  diagnostic (`[AgentScheduler] QUARANTINED (#1214): ...`) naming the enabled
  row count, so a non-owner deployment with stranded rows is loud, not
  silent.
- Quarantine is non-destructive: no row is deleted, disabled, or migrated by
  this code path. A documented, human-run backup/disable procedure lives in
  `docs/release/hosted_deployment_synology_cloudflare.md` → "Scheduler
  quarantine".
- `RHYTHM_ROLE=cloud` is separately recommended (not required by this fix) in
  the hosted `.env.production.example` — it disables the other
  agent-execution surfaces (routes, opencode engine spawn, WS gateway) that
  are pointless on a Postgres-backed API, but the scheduler-ticking guard
  above does not depend on it.

## Alternatives considered

- **Derive the `RHYTHM_ROLE` default from `DB_CLIENT`** (e.g. Postgres implies
  `cloud` unless explicitly overridden). Rejected: this would silently change
  route registration and opencode-engine startup behavior for the real
  running production container the moment this code deploys (Watchtower
  auto-deploys `:main` within ~30 minutes) — a much larger, less
  reviewable blast radius than a single, additive scheduler-only gate.
- **Delete/reconcile the legacy rows directly in this change.** Rejected per
  the issue's own safety constraints: no destructive migration against
  production without a verified backup and explicit human approval.
- **Route scheduler MCP tools to local as the sole fix (#1213 only), leaving
  production ticking unaddressed.** Insufficient: #1213 stops NEW
  agent-initiated mutations of the production row set, but does not stop the
  production process's own internal cron tick from continuing to advance/
  fail its existing enabled rows every minute.

## Consequences

- The next deployed image quarantines the hosted API's scheduler
  automatically — no operator action is required for the ticking/failure loop
  to stop. The stranded rows remain in the database (recoverable) until an
  operator works through the documented backup/disable procedure.
- If a future deployment genuinely wants a Postgres-backed process to also
  own agent execution (a currently undocumented, unsupported configuration),
  this gate would need an explicit, separate override — not the situation
  today's production deployment is in.
- `docs/ai/architecture.md` now states the ownership rule; the hosted
  deployment doc's env var list and `.env.production.example` now reflect
  `DB_CLIENT=postgres` (correcting a previously stale/contradictory example
  that listed `DB_CLIENT=sqlite` alongside Postgres connection variables).
