---
date: 2026-10-01
repo: Rhythm
branch: opencode/delivery-attachments-20261001
pr: null
issues: [A1]
status: pending
tags: [run, Rhythm]
---

## Files

- `apps/api_server/src/services/media_artifact_store.ts` and `controllers/media_artifacts_controller.ts`: await an owner lookup against Postgres before serving or pinning artifacts.
- `apps/web/src/components/Composer.tsx`: reject encoded or combined selected files before WebSocket send while retaining the draft and selection.
- `apps/api_server/src/services/ws_gateway.ts`: cap only the legacy agent WebSocket at 20 MiB and reject combined parts above its frame budget before normalization/provider forwarding.
- `apps/api_server/src/__tests__/attachment_owner_postgres.test.ts`, `attachment_owner_postgres_live.test.ts`, `apps/web/tests/contract/attachment-picker-bytes.test.mjs`, and `attachment-composer-limit.spec.ts`: owner and size regressions.
- `apps/api_server/src/__tests__/regressions_attachment_access_live.test.ts`: additive mobile Device replay case (hosted artifact reference reaches the real engine as exact bytes; another owner is denied).

## Checks

- Red before repair: Postgres owner unit exposed allow; GET/PIN unit exposed unresolved Promise; selected 16 MiB XLSX resolver test failed.
- Red before gateway cap: three individually valid 7 MiB data URLs in one parts frame reached `promptAsync`.
- `cd apps/api_server && ./node_modules/.bin/vitest run src/__tests__/attachment_owner_postgres.test.ts src/__tests__/media_artifact_store.test.ts src/__tests__/attachment_hosting.test.ts --maxWorkers=1 --no-file-parallelism`: 3 files, 16 tests passed.
- `cd apps/api_server && RHYTHM_A1_PG_TEST=1 RHYTHM_A1_PG_PORT=15483 ./node_modules/.bin/vitest run src/__tests__/attachment_owner_postgres_live.test.ts --maxWorkers=1 --no-file-parallelism`: 1 file, 1 test passed against the isolated Postgres 17 instance at `/private/tmp/rhythm-a1-owner-pg-20261001`.
- The live test queried `SHOW data_directory` before creating an isolated schema. Wrong owner GET/PIN returned 404 and left `pinned=false`; owner GET streamed the exact registered bytes and PIN persisted `pinned=true`.
- `cd apps/api_server && ./node_modules/.bin/tsc --noEmit -p tsconfig.json`: passed.
- `cd apps/api_server && ./node_modules/.bin/vitest run src/__tests__/opc_m4_1_file_attachments.test.ts src/__tests__/attachment_owner_postgres.test.ts src/__tests__/media_artifact_store.test.ts src/__tests__/attachment_hosting.test.ts --maxWorkers=1 --no-file-parallelism`: 4 files, 20 tests passed after gateway cap.
- `cd apps/api_server && ./node_modules/.bin/vitest run src/__tests__/regressions_attachment_access_live.test.ts --maxWorkers=1 --no-file-parallelism`: 10 tests skipped with live flag off; the new mobile case remains pending a combined sandbox with the M1 adapter and `RHYTHM_LIVE_HUMAN_CAPABILITY`.
- `PLAYWRIGHT_BROWSERS_PATH=apps/web/node_modules/a1-browsers node --test apps/web/tests/contract/attachment-picker-bytes.test.mjs`: 4 passed.
- `cd apps/web && PLAYWRIGHT_BROWSERS_PATH=./node_modules/a1-browsers ./node_modules/.bin/playwright test --config tests/contract/attachment-composer-limit.config.ts`: 2 passed in rendered Chromium using intercepted API/engine endpoints at the CSP-approved 4001/4096 addresses; no API or engine launched.
- `cd apps/web && npm run typecheck`: passed. `git diff --check`: passed.

## Notes

- The dedicated Postgres process was stopped with its own `pg_ctl`; its port had no listener and its PID file was gone before the exact test data directory was removed.
- This is a focused A1 repair. Full attachment integration and installed-client acceptance remain with the orchestrator.
