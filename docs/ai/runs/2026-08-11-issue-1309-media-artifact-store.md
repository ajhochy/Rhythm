---
date: 2026-08-11
repo: Rhythm
branch: mega-ws/media
pr: null
issues: [1309]
status: verification-pending
tags: [run, Rhythm]
---

# Issue #1309 media artifact store

## Files

- Added the `media_artifacts` SQLite/Postgres schema and checksum-addressed filesystem store.
- Added authenticated project-scoped serving/pinning plus paired-mobile pass-through and byte ranges.
- Added generated-image and finished local design registration, replay idempotency, retention, and tests.

## Checks

- Baseline: `cd apps/api_server && npx vitest run src/contract/issue_1309_artifact_store.test.ts` — FAIL as expected, 8/8 contract assertions.
- `cd apps/api_server && npx vitest run src/__tests__/media_artifact_store.test.ts src/contract/issue_1309_artifact_store.test.ts src/contract/issue_1309_artifact_store_live.test.ts src/__tests__/opencode_stream_bridge.test.ts src/__tests__/issue_1208_gallery_mp4_thumbnail.test.ts --no-file-parallelism` — PASS after the final edit: 62 passed / 3 env-gated skipped.
- `cd apps/api_server && ./node_modules/.bin/tsc --noEmit` — PASS (`TSC_EXIT=0`).
- `cd apps/api_server && npm run lint` — PASS (repository lint command is currently a TODO echo).
- `cd apps/api_server && npm run build` — PASS, including the postbuild security-advisory copy.
- Broad `npm test -- --no-file-parallelism` was attempted. The process-bound `issue_1186_sandbox_foreground.test.ts` had 3 failures because its sandbox teardown reported port 4098 occupied; the non-socket sweep then isolated 5 `engraph_manager.test.ts` failures, all explicit `listen EPERM` errors. No #1309-focused check failed.
- `src/contract/issue_1309_artifact_store_live.test.ts` remains env-gated and was not run because the worker sandbox cannot bind sockets. The outer orchestrator must run it against the isolated sandbox.

## Notes

- GitNexus upstream impact was LOW for all indexed edited entry points; `_relayEvent` remained unindexed/UNKNOWN. Compare-to-main change detection reported LOW risk and no affected indexed processes.
- Git commits could not be created in this worker sandbox because Git needs to write the worktree lock under the parent checkout's read-only `.git/worktrees/ws-media` directory.
