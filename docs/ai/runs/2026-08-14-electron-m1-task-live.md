---
date: 2026-08-14
repo: Rhythm
branch: codex/react-electron-live-suite
pr: null
issues: [task-live-lifecycle]
status: ready-for-verification
tags: [run, rhythm, web, tasks]
---

## Contract

- `docs/ai/contracts/task-live-lifecycle.json` and `.md`
- Initial failing contract command: `RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_API_URL=http://127.0.0.1:4098 RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:4097 RHYTHM_LIVE_DB_PATH=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/rhythm-dev-sandbox/rhythm.db npx playwright test tests/tasks/task-live-lifecycle.live.spec.ts --workers=1`
- Initial failure proved fixture fallback: expected generated `smoke-task-*`; the page rendered 110 fixture rows.

## Files changed

- `apps/web/src/gateway/tasks.ts`
- `apps/web/src/gateway/index.ts`
- `apps/web/src/main.tsx`
- `apps/web/src/pages/tasks/index.tsx`
- `apps/web/tests/tasks/task-live-lifecycle.fixture.spec.ts`
- `apps/web/tests/tasks/task-live-lifecycle.live.spec.ts`
- `docs/ai/contracts/task-live-lifecycle.{json,md}`

## Checks

- `tools/dev/sandbox.sh status` — API `:4098`, engine `:4097`, gateway `:4099` healthy; copied DB is `/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/rhythm-dev-sandbox/rhythm.db`.
- `npm run typecheck` — PASS.
- `npx playwright test tests/tasks/task-live-lifecycle.fixture.spec.ts tests/pages/tasks.spec.ts --workers=1` — PASS, 6/6.
- Authorized owner-only continuation uses the API `isShared` projection, not fixture IDs or a gateway-mode bypass. The fixture shared delete gate is disabled. The live suite created a real owner task, edited it, completed it, reloaded it, verified secondary 404 denial and collaborator `isShared: true`, deleted it in the UI, and verified absence after reload.
- Evidence-only correction passed: the browser observed `DELETE /tasks/:id → 204` immediately after the UI confirmation, then reload proved the edited task absent. The populated-state screenshot was naturally replaced at `1440x900`, SHA-256 `f0fb7120d7a1ebacc036f57b782702b8f682577e0144d0d30b51fd8268b26c4c` (132391 bytes).
- `npm run typecheck` — PASS; `npm run build` — PASS (existing Vite >500 kB chunk warning only); `npm run test:dist-smoke` — PASS; `npm run test:list` — PASS, 252 tests in 38 files.
- `shasum -a 256 -c SHA256SUMS` — PASS, 144/144. Reconciled inventory root: `4eab4560806627006c41b586f4056d7b81685c7e9de1bed60ec7887d0d72f9e1`.

## Notes

- No backend routes or handlers changed. `GET/POST/PATCH/DELETE /tasks` are authenticated by the existing server route.
- Tokens were random disposable session UUIDs, never emitted to logs, receipts, screenshots, or this note. `finally` cleanup deletes task rows, sessions, and users by generated user IDs.
- WAIVED: checksum/provenance reconciliation is non-behavioral; verification is SHA256SUMS 144/144 verification and its root digest. No product, test, package, screenshot, backend, or service changes were made in this reconciliation run.
