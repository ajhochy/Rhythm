---
date: 2026-06-24
repo: Rhythm
branch: feature/agent-scheduler
pr: 734
issues: [A-prod-trigger-scope-model-parity]
status: automated-verification-pass
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# Production-trigger Scope/Model Parity

## Files Changed

- `apps/api_server/src/services/agentSchedulerService.ts` — production scheduler path resolves effective profile scope/model via `resolveProfileScope` before inserting `pending_claude_triggers`.
- `apps/api_server/src/database/migrations.ts` — SQLite migration adds nullable `model_provider` / `model_id` to `pending_claude_triggers`.
- `apps/api_server/src/database/postgres_bootstrap.ts` — Postgres bootstrap mirrors the new pending-trigger model columns.
- `apps/api_server/src/repositories/claude_triggers_repository.ts` — trigger responses expose `modelProvider` / `modelId`.
- `apps/api_server/src/__tests__/prod_trigger_parity_contract.test.ts` — contract tests for scope inheritance, explicit scope override, task model override, and profile model fallback.
- `apps/api_server/src/__tests__/scheduled_task_columns_contract.test.ts` — schema coverage for pending-trigger model columns.
- `apps/api_server/src/__tests__/claude_triggers.test.ts` — GET exposure coverage for model fields.
- `apps/api_server/src/__tests__/issue_739_scheduler_agent_runner.test.ts` — test mock updated to include `resolveRunModel`, matching the new import path through `resolveProfileScope`.
- `docs/ai/contracts/issue-A-prod-trigger-scope-model-parity.json` — acceptance contract, all criteria marked pass after verification.
- `docs/ai/generated-issues/A-prod-trigger-scope-model-parity.md` — local issue body recovered from the interrupted workflow.
- `docs/ai/decisions.md` — compatibility index for workflow tooling; canonical decisions remain one file each under `docs/ai/decisions/`.

## Checks Run

- `npx vitest run src/__tests__/prod_trigger_parity_contract.test.ts` — PASS, 5 tests.
- `npx vitest run src/__tests__/scheduled_task_columns_contract.test.ts` — PASS, 8 tests.
- `npx vitest run src/__tests__/claude_triggers.test.ts` — PASS, 7 tests.
- `npx vitest run src/__tests__/scheduler_dispatch_contract.test.ts` — PASS, 7 tests.
- `npx vitest run src/__tests__/issue_739_scheduler_agent_runner.test.ts` — PASS, 4 tests after triage.
- `npx tsc --noEmit` — PASS.
- `ai-workflow checks --level issue` — PASS.
- `ai-workflow checks --level pr` — PASS.
- `npm run build` in `apps/api_server` — PASS.
- Full `npx vitest run` in `apps/api_server` — PASS, 139 files / 1178 tests.
- `node .gitnexus/run.cjs detect_changes --repo Rhythm` — low risk, expected scheduler/migration/repository symbols.

## Notes

- Failure triage: the first full Vitest run failed because `issue_739_scheduler_agent_runner.test.ts` fully mocked `agent_runner` without `resolveRunModel`; the new production import path reaches `resolveProfileScope`, which imports `resolveRunModel`. The fix was limited to the test boundary by adding a deterministic `resolveRunModel` mock.
- Smoke: `ai-workflow checks --level smoke` is manual-only. `apps/api_server/scripts/smoke-launch.sh` was not run because ports 4001/4096 were already occupied and the script kills existing listeners.
- Out-of-scope follow-ups remain: Flutter drain consumption of prompt/scope/model fields; research/webhook trigger producer parity.
