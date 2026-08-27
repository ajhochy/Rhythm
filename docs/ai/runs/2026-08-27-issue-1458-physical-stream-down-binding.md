---
date: 2026-08-27
repo: Rhythm
branch: fix/bridge-stream-reliability-repair
pr: 1487
issues: [1458]
status: ready_for_verification
tags: [run, Rhythm]
---

# Issue #1458 physical stream-down binding

## Scope

- Worktree: `/private/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/rhythm-s2-verify`.
- Started clean at `014f2c8ecc5d0884bb150df9ee065329a09fac33` on `fix/bridge-stream-reliability-repair`.
- Added only an isolated-live bridge fault seam, its security/bridge tests, and the real c1/c4 live assertion. No sandbox or server was started because verification is serial and other repair agents were active.
- Confirmed `docs/ai/contracts/issue-1457.json` contains c1-c9 with c9 passing; no c10 was invented and the reconnect UI criterion remains bound.

## Phase 0 — failing acceptance contract

- Added the route registration/security contract before implementation.
- Command: `cd apps/api_server && npx vitest run src/__tests__/issue_1458_live_bridge_control_routes.test.ts`.
- Expected failure: **1 failed, 3 passed**; isolated-live startup received `404` instead of the required `200` suspend control.

## Phase 1 — impact

- Attempted GitNexus API impact for `/__test/opencode/global-stream/suspend` and upstream symbol impact for `createApp`, `ensureGlobalStream`, and `resubscribeGlobalStream` before production edits.
- Every check returned risk `UNKNOWN`, impacted count 0, because the indexed LadybugDB is v42 while the connected client storage version is v41: `Database file version: 42, Current build storage version: 41`. No HIGH/CRITICAL result was returned.

## Files

- `apps/api_server/src/app.ts` — registers loopback-only suspend/resume routes only when both isolated-live startup flags equal `1`.
- `apps/api_server/src/services/opencode_stream_bridge.ts` — test-only suspend aborts the active global stream, suppresses retries, marks hub/bridge reconnecting, and resume re-enters normal ensure/recovery.
- `apps/api_server/src/__tests__/issue_1458_live_bridge_control{,_routes}.test.ts` — binds env registration, loopback denial predicate, direct method guards, abort/no-retry health degradation, and recovery.
- `apps/api_server/src/__tests__/issue_1458_bypass_engine_permission_live_e2e.test.ts` — while the bridge is physically suspended and engine health remains good, drives real built-in read/edit and an external-directory read through the real engine permission path; asserts completed results, no engine pending permission, no permission card, then bridge recovery.
- `docs/ai/contracts/issue-1458.json` — c1/c4 now bind to the executable live test. Bash remains intentionally excluded per #878.

## Checks

- Focused seam/contract command: **8 passed, 1 live skipped**.
- Updated S2 focused suite: **162 passed, 6 skipped**; live files skipped normally.
- Fail-closed probe: `env -u RHYTHM_LIVE_E2E_ISOLATED -u DB_PATH RHYTHM_LIVE_E2E=1 npx vitest run src/__tests__/issue_1458_bypass_engine_permission_live_e2e.test.ts --no-file-parallelism` — expected nonzero before network access with `RHYTHM_LIVE_E2E_ISOLATED=1 is not set` and default-real-DB refusal.
- `node_modules/.bin/tsc --noEmit` — PASS.
- `npm run build` — PASS, including postbuild.
- `git diff --check` — PASS; changed scope is the bridge seam, two focused tests, strengthened live test, contract, and this run note.
- GitNexus `detect_changes(scope: all)` was attempted before commit and failed with the same v42 index/v41 client mismatch.
- Sandbox/live execution: **not run by instruction; pending serial verification**.

## Serial sandbox command readiness

```bash
cd apps/opencode_fork/packages/opencode && bun run build --single
cd ../../../api_server && npm run build
cd ../..
RHYTHM_LIVE_E2E=1 \
RHYTHM_LIVE_E2E_ISOLATED=1 \
RHYTHM_APPROVED_FIXTURE_ROOT="$RHYTHM_APPROVED_FIXTURE_ROOT" \
RHYTHM_LIVE_DB_PATH="$RHYTHM_LIVE_DB_PATH" \
RHYTHM_SANDBOX_OPENCODE_CONFIG="$RHYTHM_SANDBOX_OPENCODE_CONFIG" \
RHYTHM_SANDBOX_DIR="$RHYTHM_SANDBOX_DIR" \
  tools/dev/sandbox.sh up
tools/dev/sandbox.sh status
cd apps/api_server
RHYTHM_LIVE_E2E=1 \
RHYTHM_LIVE_E2E_ISOLATED=1 \
RHYTHM_LIVE_URL=http://127.0.0.1:4098 \
RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:4097 \
RHYTHM_SANDBOX_DIR="$RHYTHM_SANDBOX_DIR" \
DB_PATH="$RHYTHM_SANDBOX_DIR/rhythm.db" \
RHYTHM_LIVE_DB_PATH="$RHYTHM_SANDBOX_DIR/rhythm.db" \
  npx vitest run src/__tests__/issue_1458_bypass_engine_permission_live_e2e.test.ts --no-file-parallelism
cd ../..
tools/dev/sandbox.sh down
```

The same two live flags must be present when `sandbox.sh up` starts the API; otherwise the `__test` route is intentionally absent.
