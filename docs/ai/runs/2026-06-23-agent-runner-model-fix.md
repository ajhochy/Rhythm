---
index: "[[Rhythm]]"
date: 2026-06-23
repo: Rhythm
branch: feature/agent-scheduler
pr: "734"
issues: 738-fix
status: verified (headless) — manual smoke pending
tags: [run, Rhythm]
---

## Files changed

| File | Change |
|------|--------|
| `apps/api_server/src/services/agent_runner.ts` | Added `resolveRunModel()` (3-step cascade), `_recordSession()`; updated `run()` to resolve model before promptAsync and record session row; updated `AgentRunOptions` with `agentConfigId`/`agentKind`/`sessionName`/`scheduledTaskId` |
| `apps/api_server/src/services/agentSchedulerService.ts` | Pass `agentKind`/`scheduledTaskId`/`sessionName` to `AgentRunner.run()`; added stale-run reset on boot (`AgentSessionsRepository.resetStaleRunning`) for SQLite path |
| `apps/api_server/src/repositories/agent_sessions_repository.ts` | Added `findMostRecentlyUsedModel()`, `resetStaleRunning()`; updated `insert()` to include `scheduled_task_id` column |
| `apps/api_server/src/repositories/agent_configs_repository.ts` | Added `modelProvider`/`modelId` to `AgentConfig`, `AgentConfigInput`, `AgentConfigRow`, `rowToModel()`, `insert()`, `update()` |
| `apps/api_server/src/controllers/agent_configs_controller.ts` | Accept `modelProvider`/`modelId` in create and patch handlers |
| `apps/api_server/src/database/migrations.ts` | Additive SQLite migrations: `agent_configs.model_provider TEXT`, `agent_configs.model_id TEXT`, `agent_sessions.scheduled_task_id TEXT` |
| `apps/api_server/src/database/postgres_bootstrap.ts` | Matching additive `ALTER TABLE … ADD COLUMN IF NOT EXISTS` for all three columns |
| `apps/api_server/src/__tests__/issue_738_agent_runner.test.ts` | Updated `promptAsync` assertion to expect resolved model `{providerID,modelID}` instead of `undefined` |
| `apps/api_server/src/__tests__/issue_739_scheduler_agent_runner.test.ts` | Added `AgentSessionsRepository` mock so stale-run reset doesn't pollute `mockDbRun` assertions |
| `apps/api_server/src/__tests__/issue_738_fix_model_and_session.test.ts` | NEW — 10 tests: model cascade (config/MRU/default), session recording, schema columns |
| `apps/api_server/src/__tests__/issue_738_fix_stale_run_recovery.test.ts` | NEW — 2 tests: stale-run reset called on SQLite, skipped on Postgres |

## Checks run

| Check | Result |
|-------|--------|
| `tsc --noEmit` | PASS — 0 errors |
| `npm test` (vitest) | PASS — 965/965 (+12 new tests; baseline was 953) |
| `ai-workflow checks --level issue` | PASS — flutter analyze + dart format + api_server tsc all green |
| `ai-workflow checks --level pr` | PASS — all 4 checks green |

## Root cause fixed

`AgentRunner.run()` called `opencodeClient.promptAsync(sessionId, prompt, undefined, cwd)` — the third argument is the model `{providerID, modelID}`, passed as `undefined`. With no model, opencode never generates a response → `_waitForAssistantReply` polled until the 600 s timeout → every scheduled task was stuck "running" forever and produced nothing.

## Decisions

- **3-step model cascade:** agent config `model_provider`/`model_id` → most-recently-used from `agent_sessions.provider_id`/`model_id` → hardcoded `anthropic/claude-sonnet-4-5`. See `docs/ai/decisions/2026-06-23-agent-runner-model-resolution.md`.
- **`_recordSession` is non-fatal:** a DB error logs a warning and returns null; the run proceeds. The opencode session id is the fallback in `result.sessionId`. This ensures a DB hiccup doesn't block agent execution.
- **Stale-run reset is SQLite-only:** `agent_sessions` is a local SQLite table; Postgres path is production and doesn't have this table. Guard is `if (env.dbClient !== 'postgres')`.

## Notes

- No Flutter files were touched — this is a pure api_server change.
- `scheduled_task_id` column was already in the `agent_sessions` model/repository row type but had never been added to migrations or included in the `INSERT` statement. Both gaps fixed here.
- Manual smoke should include: trigger a scheduled task, confirm a session row appears in CHATS with name "Scheduled: <task name>".
