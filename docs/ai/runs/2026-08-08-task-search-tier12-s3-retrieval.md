---
date: 2026-08-08
repo: Rhythm
branch: feat/task-search-tier12
pr: null
issues: [task-search-tier12-s3]
status: PASS
tags: [run, api_server, task-search]
---

## Files

- `apps/api_server/src/repositories/tasks_repository.ts`
- `apps/api_server/src/__tests__/tasks_repository.test.ts`
- `docs/ai/contracts/task-search-tier12-s3.json`

## Acceptance contract

Created before implementation: `docs/ai/contracts/task-search-tier12-s3.json`.

Initial failing run:

```text
cd apps/api_server && env -u AGENT_LOCAL -u MEMORY_VAULT_SUBDIR npx vitest run src/__tests__/tasks_repository.test.ts --no-file-parallelism
19 tests: 16 passed, 3 failed
search retrieves title and notes candidates
AssertionError: expected [ 'Weekly Meeting' ] to include 'Prepare agenda'
```

## Checks

```text
cd apps/api_server && env -u AGENT_LOCAL -u MEMORY_VAULT_SUBDIR npx vitest run src/__tests__/tasks_repository.test.ts src/__tests__/tasks_controller.test.ts --no-file-parallelism && node_modules/.bin/tsc --noEmit
2 files passed, 50 tests passed; tsc passed
```

`gitnexus_detect_changes(scope=all)` reported low risk and no affected indexed processes. It also reports the concurrent S2 schema symbols in this shared worktree.

## Notes

- Nonblank SQLite search uses bound `tasks_fts MATCH ?` terms derived from lexical tokens; unavailable FTS5 logs and falls back to bound title+notes `LIKE` predicates.
- Nonblank Postgres search uses bound `tasks.search_vector @@ plainto_tsquery('english', $N)` candidates. Both paths final-rank the candidate corpus with shared BM25 and deterministic canonical/id ties.
- Common candidate corpora have identical shared-BM25 ordering after retrieval. Candidate membership can differ at stemming edges: Postgres uses English stemming while SQLite FTS5 uses its own tokenization. This slice deliberately does not scan to erase that database-native difference.
- Shared sandbox on `:4098/:4097` was not started, restarted, or stopped.
