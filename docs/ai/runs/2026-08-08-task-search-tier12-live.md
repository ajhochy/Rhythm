---
date: 2026-08-08
repo: Rhythm
branch: feat/task-search-tier12
pr: null
issues: [task-search-tier12]
status: PASS
tags: [run, rhythm, task-search, live-e2e]
---

# Task-search Tier 1+2 — S5 live behavioral evidence

## Files

- `apps/api_server/src/__tests__/task_search_live_e2e.test.ts`
- `docs/ai/contracts/task-search-tier12-live.json`
- `docs/ai/runs/2026-08-08-task-search-tier12-live.md`

## Acceptance

WAIVED: documentation-only evidence-hygiene repair; verification is: owned-file diff review and `git diff --check`.

The initial live-contract attempt was red before finalizing the test harness: the real MCP stdio child path omitted the `apps/` segment and failed with `spawn .../mcp_server/node_modules/.bin/tsx ENOENT`. Correcting that new-test-only path produced the executable contract below; no production file changed.

The test is skipped unless `RHYTHM_LIVE_E2E=1`. It creates a disposable sandbox user/session only because the public auth surface is OAuth-only; all task fixtures are created, updated, and deleted through authenticated public `/tasks` HTTP endpoints. The test launches the actual `apps/mcp_server/src/index.ts` stdio entrypoint and sends JSON-RPC MCP calls without mocks.

## Checks

| Command | Result |
|---|---|
| `cd apps/api_server && env -u RHYTHM_LIVE_E2E npx vitest run src/__tests__/task_search_live_e2e.test.ts --no-file-parallelism` | PASS — 1 file skipped, 3 tests skipped |
| `cd apps/opencode_fork/packages/opencode && bun run build --single` | PASS — fork smoke test passed (`0.0.0-feat/task-search-tier12-202608080847`) |
| `cd apps/api_server && npm run build` | PASS |
| `tools/dev/sandbox.sh up && tools/dev/sandbox.sh status` | PASS — API :4098 PID 67534; engine :4097 PID 67555 |
| `cd apps/api_server && RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_API_URL=http://127.0.0.1:4098 RHYTHM_LIVE_DB_PATH="$TMPDIR/rhythm-dev-sandbox/rhythm.db" npx vitest run src/__tests__/task_search_live_e2e.test.ts --no-file-parallelism` | PASS — 1 file, 3 tests, 767 ms |
| `cd apps/api_server && node_modules/.bin/tsc --noEmit` | PASS |
| `cd apps/api_server && npx vitest run src/__tests__/task_search_schema.test.ts --no-file-parallelism` | PASS — 1 file, 3 tests; deterministic SQLite and Postgres SQL contract |
| `tools/dev/sandbox.sh down && tools/dev/sandbox.sh status; lsof -nP -iTCP:4098 -sTCP:LISTEN; lsof -nP -iTCP:4097 -sTCP:LISTEN` | PASS — sandbox removed; no API or engine listeners |
| `git diff --check -- <five owned Tier 1+2 run notes>` | PASS — documentation-only status hygiene repair |

## Observable live evidence

- Sandbox `/health` and `/opencode/health` were healthy; engine reported `ready`.
- Actual MCP stdio `rhythm_list_tasks` returned exactly two ranked fixtures for `limit=2`, with the strongest multi-token fixture first, `total: 4`, `more: 2`, exact `+2 more` guidance, documented-field-only projection, clipped notes marker, and untrusted-content fences.
- A no-search actual MCP call returned no more than 50 tasks with consistent `returned`, `total`, and `more` metadata.
- Public HTTP PATCH made the replacement term visible through the next MCP/SQLite FTS search and removed the prior term; public DELETE removed it from the next search.
- SQLite is live-proven. No isolated Postgres runtime was configured; deterministic Postgres generated-vector/GIN SQL coverage passed and is recorded in the integrated contract as the retained evidence.
