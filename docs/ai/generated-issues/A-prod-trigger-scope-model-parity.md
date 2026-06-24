# A — Production-trigger path: model override + profile scope inheritance parity

**Labels:** `api-server`, `agents`, `scheduler`, `follow-up`
**Branch:** stack on `feature/agent-scheduler` (PR #734) — no merge
**Design authority:** `docs/ai/decisions/2026-06-24-scheduled-task-model-and-scope.md` (Consequences → "Scope" note flags this follow-up)
**Depends on:** P1a `resolveProfileScope` (landed `a7baf45`), model-override/scope-inherit (landed `63a493e`)

## Context / Background

The model override (`model_provider`/`model_id`) and profile **scope inheritance** currently apply **only on the local `AgentRunner` path** (`env.agentLocal === true`). The production path in
`apps/api_server/src/services/agentSchedulerService.ts` → `insertScheduledTrigger` (~line 225) inserts a `pending_claude_triggers` row that forwards the task's **RAW** `allowed_mcps_json` / `allowed_skills_json` and carries **no model** at all — so a prod-drained scheduled run neither inherits the bound profile's scope nor honors a per-task model.

### Drain-path investigation (cross-system boundary — DOCUMENTED)

Traced the full lifecycle of a `pending_claude_triggers` row:

- **Producer (this repo):** `agentSchedulerService.insertScheduledTrigger` (prod branch, `env.agentLocal === false`). Also `agentResearchController.ts` and `agentWebhookController.ts` have their own inserts (out of scope here; see Follow-ups).
- **Server-side drain:** **none.** The only server consumers are `claude_triggers_repository` `GET /claude-triggers` (`listForUser`) and `DELETE /claude-triggers/:id`. No server cron/worker executes triggers.
- **Client-side drain (cross-system):** the Flutter desktop app's `AgentTriggerWatcher` (`apps/desktop_flutter/lib/app/core/agents/agent_trigger_watcher.dart`) polls `GET /claude-triggers` every 10 s and hands each row to `AgentsController.handleIncomingTrigger`.
- **Executor:** ultimately the **local agent server** (`localhost:4001`, the same `AgentRunner` in this repo), reached after a user interacts with the surfaced trigger.

**Key finding:** `handleIncomingTrigger` (`agents_controller.dart:2208`) extracts **only** `taskId` / `taskTitle` / `taskNotes` and **discards** `prompt`, `scheduled_task_id`, `allowed_mcps_json`, `allowed_skills_json`. `PendingTrigger` has no scope/model/prompt fields. So today the production-drained scheduled run is **not wired** to execute its prompt autonomously with task scope/model — that client wiring is a **separate, larger cross-system change** (Follow-up B-flutter below), not part of this issue.

### Why resolve at INSERT (server-side), not at execution

`resolveProfileScope` + `resolveTaskScopeOverride` live in `api_server` (TS). The eventual executor is Dart/local and **cannot reuse them without duplicating scope logic** (explicitly forbidden by the design). Therefore the trigger row must be made **self-describing**: the scheduler resolves the **effective** scope + model at insert time and writes those values into the row. "Carry the per-task model through to whatever drains the trigger" = the row carries the final effective model.

## Goal

Bring the production-trigger insert to behavioral parity with the local path, **precedence identical**: **task override > profile > default**.

- Inherit the bound profile's MCP + skill scope when the task's own allowlist is null/empty (reuse `resolveTaskScopeOverride` + `resolveProfileScope` — **do not duplicate scope logic**).
- Carry the per-task `model_provider`/`model_id` (falling back to the profile's resolved model) through the trigger row.
- An explicit task allowlist still overrides the profile.

## Acceptance Criteria

- [ ] **AC1 (scope inherit):** a due task on the production path (`env.agentLocal === false`) with **null/empty** `allowed_mcps_json` writes the **profile's** effective MCP allowlist into the trigger row's `allowed_mcps_json` (not raw null). Same for `allowed_skills_json`.
- [ ] **AC2 (scope override):** a due task with an **explicit** `allowed_mcps_json` (e.g. `["rhythm"]`) writes **that** value into the row (override wins over profile). Same for skills.
- [ ] **AC3 (model carry — task override):** a due task with both `model_provider` + `model_id` writes those exact values into the row's new `model_provider`/`model_id` columns.
- [ ] **AC4 (model carry — profile fallback):** a due task **without** a model override writes the **profile's** resolved model (`resolveProfileScope(...).model`) into the row's model columns.
- [ ] **AC5 (schema):** `pending_claude_triggers` gains nullable `model_provider` / `model_id` columns — pragma-guarded `ALTER` on SQLite (`migrations.ts`) + `ADD COLUMN IF NOT EXISTS` on Postgres (`postgres_bootstrap.ts`). Additive, no behavior change to existing columns.
- [ ] **AC6 (exposure):** `claude_triggers_repository` `SELECT_SQL` + `PendingClaudeTrigger` interface + `rowToModel` expose `modelProvider` / `modelId` so the GET response carries them to the drain.
- [ ] **AC7 (no regression):** the local `AgentRunner` path and the chat path are unchanged; existing scheduler/scope contract tests stay green.

## Likely Files

- `apps/api_server/src/services/agentSchedulerService.ts` — `insertScheduledTrigger` (resolve effective scope+model; new params) + the prod branch in `checkDueTasks` that calls it.
- `apps/api_server/src/database/migrations.ts` (~1389) — add `model_provider`/`model_id` ALTERs (SQLite).
- `apps/api_server/src/database/postgres_bootstrap.ts` (~570) — add `ADD COLUMN IF NOT EXISTS` (Postgres).
- `apps/api_server/src/repositories/claude_triggers_repository.ts` — `SELECT_SQL`, `PendingClaudeTrigger`, `rowToModel`.

## Required Tests

- New contract test `src/__tests__/prod_trigger_parity_contract.test.ts` mirroring `scheduler_dispatch_contract.test.ts`: spy `env.agentLocal = false`, mock `resolveProfileScope` (or a real profile in the test DB), drive the cron tick, capture the values bound into the INSERT (mock `getDb().prepare().run` like the existing dispatch test does for `mockDbRun`). Assert AC1–AC4.
- A schema-parity assertion that both SQLite + Postgres define `model_provider`/`model_id` on `pending_claude_triggers` (mirror `scheduled_task_columns_contract.test.ts`).
- Full `npx vitest run` + `tsc -p tsconfig.json` green.

## Safety / Notes

- **Postgres/SQLite parity:** new columns must be added to BOTH `migrations.ts` and `postgres_bootstrap.ts` or prod will 500 (see memory `postgres_postgres_sqlite_schema_drift`).
- `resolveProfileScope` never throws; preserve that — a profile-lookup failure must not abort the scheduler tick (existing try/catch around the prod branch stays).
- Effective MCP allowlist comes from `eff.mcpRoleConfig?.allowedToolsJson ?? null` (the helper's echo of the effective JSON); effective skills from `eff.allowedSkillsJson`.

## Follow-ups (out of scope — file separately)

- **B-flutter (cross-system, larger):** wire the Flutter `AgentTriggerWatcher` / `handleIncomingTrigger` / `PendingTrigger` / `createSession` path (and the local `/agent-sessions` contract) to actually **consume** `prompt` + the new scope/model fields so a production-drained scheduled run executes autonomously with task scope/model. Today it drops them.
- **research/webhook producers:** `agentResearchController.ts` + `agentWebhookController.ts` insert raw allowlists with no model too; apply the same resolve-at-insert helper for full parity.
