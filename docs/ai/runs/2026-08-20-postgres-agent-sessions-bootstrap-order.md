---
date: 2026-08-20
repo: Rhythm
branch: codex/prereq-postgres-agent-sessions-bootstrap
pr: null
issues: [task-postgres-agent-sessions-bootstrap-order]
status: verified
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

## Independent HIGH-risk verification

- Verified branch `codex/prereq-postgres-agent-sessions-bootstrap` at `b0fb1ad147989cbe7f5e3ff98f1189518b698063` against merge base `245860e81eaf9e8ef9ef9806ced7db70bd8b3471`.
- Disposable database: `postgres:16`, container `rhythm-prereq-pg-gate-b0fb1ad1`, loopback port `55483`, database `rhythm_test`; one shell trap removed the container on every exit path.
- Pure-move proof: base and HEAD blocks were byte-identical (693 bytes, 18 lines). SHA-256 without the trailing newline: `7e8ec894979ce6c3b765f9d111e1e7d4da080e13e5f9a49f62d8166486c3adbe` (with trailing newline: `c9b5098dbd34aa16a04e02a17e70ffecff7195cfa4c4d154c249d1a5bdc107bb`). `tasks` precedes the role guard; the guard return precedes the moved block; the moved block precedes the QA FK.
- Fresh role matrix: default/all/local completed two bootstraps and produced all 28 columns, required PK/indexes, and QA FK; cloud/relay completed two bootstraps with `agent_sessions` absent while `agent_scheduled_tasks` and `pending_claude_triggers` remained present. Live contract: **7/7 passed**.
- Independent all-role probe ran bootstrap three times, inserted a full-value sentinel after run one, and proved identical values after runs two and three (`sentinel_sha256=62e63439b9c87ca729a77a5b08f529e3bf1b20429e1fa40c25a51292ac889ca2`).
- Independent schema probe: 28 columns; indexes `agent_sessions_pkey`, `idx_agent_sessions_category`, `idx_agent_sessions_is_system`, `idx_agent_sessions_owner_activity`; QA `agent_session_id -> agent_sessions.id` with `SET NULL`; async delegation `parent_session_id` and `child_session_id -> agent_sessions.id` with `CASCADE`.
- `npx vitest run src/__tests__/issue_755_role_separation.test.ts src/__tests__/relay_role.test.ts --no-file-parallelism --reporter=verbose` — **28/28 passed**.
- `npm run build` and `node_modules/.bin/tsc --noEmit` — exit 0.
- Full `npm test`: branch **4472 passed, 174 skipped, 7 failed**. All seven failures reproduced with the identical command at the merge base and are classified pre-existing/out of scope: two `memory_injection`, one `memory_index_rebuild`, two `issue_1219_memory_provenance`, one `issue_1135_audit_lock_contract`, and one `delegation_caller_identity`. The exported merge-base harness had three additional VCS-checkout-dependent failures because `git archive` is not a worktree; these were not branch failures.
- Cleanup proof after the trapped run: container `rhythm-prereq-pg-gate-b0fb1ad1` absent and no listener on `:55483`.
- Isolated Rhythm sandbox used API `:4398` and engine `:4397`; health endpoints returned API `status=ok` and engine `status=ready`. Ports `:4001` and `:4096` were untouched.
- Orchestrator GitNexus `detect_changes(compare main)` after the gate: LOW risk, four changed files, zero affected indexed processes. Bootstrap remains manually HIGH because the index does not resolve the moved function.
