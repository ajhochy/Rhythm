---
date: 2026-08-08
repo: Rhythm
branch: feat/task-search-tier12
pr: null
issues: [task-search-tier12-s2]
status: PASS
tags: [run, Rhythm, task-search, schema]
---

## Files

- `apps/api_server/src/database/postgres_bootstrap.ts`
- `apps/api_server/src/database/migrations.ts`
- `apps/api_server/src/__tests__/task_search_schema.test.ts`
- `docs/ai/contracts/task-search-tier12-s2.json`

## Acceptance contract

Created before implementation: `docs/ai/contracts/task-search-tier12-s2.json`.

Initial failing command:

```bash
cd apps/api_server && env -u AGENT_LOCAL -u MEMORY_VAULT_SUBDIR npx vitest run src/__tests__/task_search_schema.test.ts --no-file-parallelism
```

Observed failure before DDL implementation: all 3 tests failed because `tasks_fts`
did not exist, its three synchronization triggers were absent, and Postgres bootstrap
did not declare `tasks.search_vector`.

## Checks

- PASS — `env -u AGENT_LOCAL -u MEMORY_VAULT_SUBDIR npx vitest run src/__tests__/task_search_schema.test.ts src/__tests__/migrations_replay_guard.test.ts --no-file-parallelism` (2 files, 6 tests)
- PASS — `node_modules/.bin/tsc --noEmit`
- PASS — `git diff --check`
- Not run — external Postgres live bootstrap contract: no `RHYTHM_LIVE_POSTGRES_*` configuration was provided. Deterministic mocked-bootstrap SQL coverage remains in `task_search_schema.test.ts`.
- Not run — shared sandbox behavioral test. This slice adds schema only and the orchestrator owns the already-running sandbox lifecycle; no task query surface exists in S2.

## Notes

- PostgreSQL uses a stored vector with title weight A and notes weight B plus `idx_tasks_search` GIN indexing. The additive ALTER and index execute before the agent-execution role early return.
- SQLite uses external-content `tasks_fts`, an every-boot FTS rebuild for pre-existing rows, and idempotent insert/update/delete triggers keyed by task `rowid`.
- Deployment risk: ordinary PostgreSQL GIN index creation can briefly lock/load the 397-task production table. It intentionally does not use `CREATE INDEX CONCURRENTLY` because bootstrap transaction behavior was not redesigned.
- No user-query logic, dependencies, task content writes, or destructive DDL were added.

## Repair evidence — focused attempt #1

- Final verification's full-suite convergence gate failed: the delegated-session
  contract expected one settled write and observed 16. Triage isolated the cause to
  the unconditional `INSERT INTO tasks_fts(tasks_fts) VALUES ('rebuild')` in every
  `runMigrations()` invocation; five indexed task rows caused 31 writes in the
  throwaway harness.
- The production repair keeps the FTS table and three trigger DDL in the structural
  `db.exec` block, and performs only the rebuild under
  `runOnce('tasks_fts_backfill_v1', ...)`. Existing legacy task rows are therefore
  indexed on first installation only; later boots do not rewrite derived FTS data.
- The S2 contract now starts from a pre-FTS legacy `tasks` fixture with two rows,
  verifies backfill plus insert/update/delete trigger sync, and asserts a settled
  replay has `total_changes()` delta zero. The general replay guard now seeds two
  indexed tasks before its unchanged whole-database snapshot assertion.

Red before production fix:

```bash
cd apps/api_server && env -u AGENT_LOCAL -u MEMORY_VAULT_SUBDIR npx vitest run src/__tests__/task_search_schema.test.ts src/__tests__/migrations_replay_guard.test.ts --no-file-parallelism
# FAIL: settled replay total_changes() delta was 19, expected 0;
# FAIL: replay guard observed changed tasks_fts shadow-table content.
```

Green after production fix:

```bash
cd apps/api_server && env -u AGENT_LOCAL -u MEMORY_VAULT_SUBDIR npx vitest run src/__tests__/task_search_schema.test.ts src/__tests__/migrations_replay_guard.test.ts --no-file-parallelism
# PASS: 2 files, 7 tests

env -u AGENT_LOCAL -u MEMORY_VAULT_SUBDIR npx vitest run src/__tests__/delegated_session_isolation.test.ts --no-file-parallelism
# PASS: 1 file, 7 tests

env -u AGENT_LOCAL -u MEMORY_VAULT_SUBDIR npx vitest run src/__tests__/tasks_repository.test.ts src/__tests__/tasks_controller.test.ts --no-file-parallelism
# PASS: 2 files, 50 tests

node_modules/.bin/tsc --noEmit
# PASS
```

- Final verification **PASS**: the data-touching migration replay remains zero-write
  after settlement (`secondMigrationDelta` 0; 74 rows before/after; one backfill
  marker; two indexed matches). Ephemeral Postgres passed 16 checks, including
  generated weighted TSVECTOR behavior and a forced Bitmap Index Scan on
  `idx_tasks_search` (`postgres_gin_execution=pass`).
