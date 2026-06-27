---
date: 2026-06-24
repo: Rhythm
branch: feature/agent-scheduler
pr: 734
issues: [sched-model-override, sched-scope-inherit]
status: verified-uncommitted
tags: [run, rhythm]
index: "[[Rhythm]]"
---

# Scheduled-task per-task model override (model-override) + profile scope inheritance (scope-inherit)

TDD via the workflow chain (acceptance-contract → coding-agent → verification-gate).
Builds on the P0–P3 scoping-parity work landed in `a7baf45` (the P1a
`resolveProfileScope` helper in particular).

## Files changed

- `apps/api_server/src/database/migrations.ts` — idempotent `model_provider`/`model_id` ALTERs (pragma-guarded, SQLite).
- `apps/api_server/src/database/postgres_bootstrap.ts` — `ADD COLUMN IF NOT EXISTS model_provider/model_id`.
- `apps/api_server/src/repositories/agent_scheduled_tasks_repository.ts` — `modelProvider`/`modelId` on interface, `CreateInput`, `rowToModel`, both INSERTs (pg + sqlite), update column map.
- `apps/api_server/src/services/agent_profile_scope.ts` — new `allowedSkillsJsonOverride` option (symmetric with `allowedMcpsJsonOverride`); resolves skills override-or-inherit.
- `apps/api_server/src/services/agent_runner.ts` — `AgentRunOptions.allowedSkillsJson`; threaded to `resolveProfileScope`; widened `modelOverride` contract doc (scheduler now a legit caller).
- `apps/api_server/src/services/agentSchedulerService.ts` — `resolveTaskScopeOverride()` (null/empty → `undefined` = inherit); dispatch passes `modelOverride` + `allowedSkillsJson` + inherited MCP scope.
- `apps/api_server/src/controllers/agentSchedulesController.ts` — create accepts/validates paired `modelProvider`/`modelId`; update auto-handled via repo map.
- `apps/mcp_server/src/tools/agentSchedule.ts` — `modelProvider`/`modelId` create inputs; clarified allowlist = inherit.
- Tests: `scheduled_task_columns_contract.test.ts`, `scheduled_task_scope_helper_contract.test.ts`, `scheduler_dispatch_contract.test.ts` (15 cases).
- Contracts: `docs/ai/contracts/issue-sched-model-override.json`, `issue-sched-scope-inherit.json` (all criteria `pass`, `not_tested=[]`).

## Checks run

- `npx tsc -p tsconfig.json --noEmit` → **0 errors**.
- `npx vitest run` (full api_server) → **1170/1170 pass**, 138 files (was 1155 + 15 new).
- Contract files → exit 0; 15/15 pass. Confirmed **failing** on unmodified code first (10 fail / 5 guards).

## Notes

- **Key decision:** scope inheritance fixed at the *scheduler* (pass `undefined` not `null`) to preserve the P1a helper's `undefined=inherit / value=override` contract for all callers. See `docs/ai/decisions/2026-06-24-scheduled-task-model-and-scope.md`.
- **Model precedence:** task override > profile (`resolveRunModel`) > hardcoded default. Chat path untouched.
- **Out of scope / follow-up:** behavior applies on the local `AgentRunner` path (`AGENT_LOCAL=true`). The production-trigger path (`pending_claude_triggers` drained by a separate executor) still forwards the task's raw allowlist and is unchanged — parity there is a follow-up.
- No repair loop fired (verification passed first try).
