# Project State

## Current focus

**2026-06-24 — Production-trigger scheduled task parity implemented and automated verification passed locally.**

Issue A (`docs/ai/generated-issues/A-prod-trigger-scope-model-parity.md`) closes the server-side gap left by the scheduled-task model/scope work: the production scheduler path now resolves the effective profile scope/model before inserting `pending_claude_triggers`.

Completed in this working tree:
- Production trigger inserts now persist effective MCP scope, skill scope, and model.
- `pending_claude_triggers` has additive nullable `model_provider` / `model_id` columns in SQLite and Postgres bootstrap.
- `ClaudeTriggersRepository` exposes `modelProvider` / `modelId` in trigger responses.
- Contract coverage exists at `docs/ai/contracts/issue-A-prod-trigger-scope-model-parity.json`.

Run detail: `docs/ai/runs/2026-06-24-prod-trigger-scope-model-parity.md`.

## Active branch / PR

- **Branch:** `feature/agent-scheduler`
- **PR:** [#734](https://github.com/ajhochy/Rhythm/pull/734) — open; do not auto-merge
- **Base:** `main`
- **Local state:** verified local commit pending push to PR #734

## In progress

Production-trigger parity is implemented locally. Automated checks passed. Local commit is pending push. Manual app smoke remains before merge.

## Risks / known issues

- **Flutter drain follow-up remains:** `AgentTriggerWatcher` / `PendingTrigger` / `AgentsController.handleIncomingTrigger` still do not consume the trigger `prompt`, scope, or model fields. This is intentionally out of scope for issue A and remains the documented B-flutter follow-up.
- **Research/webhook producers remain follow-ups:** `agentResearchController.ts` and `agentWebhookController.ts` still have independent trigger inserts that do not resolve model/scope at insert time.
- **Manual smoke not run:** existing local listeners occupied ports 4001/4096, so `apps/api_server/scripts/smoke-launch.sh` was not run because it kills those listeners. Run manual smoke before merging.
- **P3 allowlist maintenance:** `AGENT_SKILL_ALLOWLIST_MAP` is hand-maintained. Add new chain agents when the registry gains them.
- **Pre-existing flaky test:** `tasks_controller.test.ts > overdue=yes` intermittently returns 200 vs 400 due shared test DB/server state; unrelated to this work.

## Test status

| Suite | Status |
|-------|--------|
| `ai-workflow checks --level issue` | **PASS** — Flutter analyze, Dart format, API `tsc --noEmit` |
| `ai-workflow checks --level pr` | **PASS** — issue checks + API Vitest |
| `apps/api_server npm run build` | **PASS** — `tsc -p tsconfig.json` |
| `apps/api_server npx vitest run` | **PASS** — 139 files, 1178 tests |
| Focused contract tests | **PASS** — prod trigger parity, schema, trigger exposure, scheduler dispatch |
| Smoke | **MANUAL PENDING** — `ai-workflow checks --level smoke` points to `docs/testing/manual-smoke.md` |

## Next step

1. Push/update PR #734 after repo/branch confirmation, then watch CI.
2. Run manual smoke before merge, especially scheduled-task production-trigger drain behavior and existing app launch checks.
3. Implement the Flutter drain follow-up only after this server-side issue is reviewed.
