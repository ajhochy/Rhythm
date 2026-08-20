---
date: 2026-08-20
repo: Rhythm
branch: codex/prereq-postgres-agent-sessions-bootstrap
pr: null
issues: [task-postgres-agent-sessions-bootstrap-order]
status: ready_for_verification
tags: [run, Rhythm]
---

## Contract

- Contract: `docs/ai/contracts/task-postgres-agent-sessions-bootstrap-order.json`
- Failing run, before implementation: `RHYTHM_LIVE_POSTGRES_BOOTSTRAP=1 RHYTHM_LIVE_POSTGRES_URL='postgresql://postgres:***@127.0.0.1:55583/rhythm_test' npx vitest run src/__tests__/postgres_bootstrap_live.test.ts --no-file-parallelism`
- Observed failure: 5 failed / 2 passed; Postgres `relation "agent_sessions" does not exist` at `postgres_bootstrap.ts:1087`, where `agent_research_qa_links.agent_session_id` adds its FK.
- The first attempted contract launch could not load `vitest/config` because this clean worktree had no dependencies. `npm ci` installed the locked dependencies; the next run reached Postgres and reproduced the expected product failure above.

## Files changed

- `apps/api_server/src/database/postgres_bootstrap.ts` — moved the existing `agent_sessions` comment and base `CREATE TABLE` block immediately after the agent-execution role guard.
- `apps/api_server/src/__tests__/postgres_bootstrap_live.test.ts` — disposable Postgres role matrix, complete schema/FK/index assertions, populated-row preservation, and third-run idempotency.
- `docs/ai/contracts/task-postgres-agent-sessions-bootstrap-order.json` — executable acceptance contract.
- `docs/ai/runs/2026-08-20-postgres-agent-sessions-bootstrap-order.md` — this run note.

## Checks run

- Disposable database: `postgres:16`, container names `rhythm-postgres-bootstrap-contract-20260820` and `rhythm-postgres-bootstrap-verify-20260820`, loopback port `55583`, database `rhythm_test`. Shell traps removed each container on pass/fail.
- Live contract after implementation: same focused command against port `55583` — **7/7 passed**.
  - Role matrix: five fresh roles; enabled/default matrix **3** (`default`, `all`, `local`) and skip matrix **2** (`cloud`, `relay`).
  - Each enabled role bootstrapped twice and exposed all 28 required columns, the QA-link FK to `agent_sessions(id)`, and four required indexes (PK plus is-system, owner-activity, category).
  - Cloud/relay each bootstrapped twice with `agent_sessions` absent and both `agent_scheduled_tasks` and `pending_claude_triggers` present.
  - Existing-schema test inserted a sentinel with status/task/SDK/MCP/worktree/project/category values between runs and compared the complete row before/after the second run.
  - Idempotency test compared the complete sentinel row and full required schema before/after a third run.
- `npx vitest run src/__tests__/issue_755_role_separation.test.ts src/__tests__/relay_role.test.ts --no-file-parallelism` — **28/28 passed**.
- `npm run build` — exit 0, including postbuild.
- `node_modules/.bin/tsc --noEmit` — exit 0.
- `git diff --check` — exit 0.
- SQL move proof: normalized added and removed diff blocks were equal; SHA-256 `7e8ec894979ce6c3b765f9d111e1e7d4da080e13e5f9a49f62d8166486c3adbe`, 18 lines. No SQL text changed.
- Cleanup proof: `docker ps --filter name=rhythm-postgres-bootstrap` and `lsof -nP -iTCP:55583 -sTCP:LISTEN` both returned empty.
- GitNexus `detect_changes(scope=all)` reported two indexed changed files, zero resolved changed symbols/processes. The contract/run-note files were untracked and therefore outside that graph result.

## Notes

- Risk remains **manually HIGH** because this is production Postgres startup ordering. GitNexus could not resolve `runPostgresBootstrap` (`risk: UNKNOWN`); the supplied triage session `8b721406-d72c-4962-8c33-3ee81bb936cd` explicitly authorized this exact move.
- Doubt guards confirmed before editing: `tasks` is created before the new location; cloud/relay return before it; the moved base table has no dependency besides `tasks`; all later ALTER/backfill/index statements retained their relative order.
- No Bucket E files, production database, live API/engine ports, commit, push, or PR were touched.
