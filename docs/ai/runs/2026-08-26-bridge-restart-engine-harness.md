---
date: 2026-08-26
repo: Rhythm
branch: fix/bridge-stream-reliability-repair
pr: pending
issues: [1457, 1325]
status: ready_for_verification
tags: [run, Rhythm]
---

# #1457/#1325 engine-replacement test harness repair

## Scope and safety

- Worked only in `/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/rhythm-s2-verify` from clean HEAD `e4b20e26`.
- S5 owns the sole sandbox. This pass did not start, stop, inspect, or connect to any server or port.
- No production bridge, client, controller, or retry code changed.

## Phase 0 — failing acceptance contract

- Added `src/contract/issue_1457_1325_restart_harness.test.ts` before implementation.
- Command: `npx vitest run src/contract/issue_1457_1325_restart_harness.test.ts`.
- Expected failure observed: **3 failed** — `sandbox.sh` had no `restart-engine` command and both live tests waited for an engine identity change without invoking a replacement.

## Impact analysis

- GitNexus upstream impact was attempted before shared-path edits for `up`, `restart`, and `stop_recorded_engine_if_needed`.
- Each returned risk `UNKNOWN`, impacted count 0, and no HIGH/CRITICAL result because the index is LadybugDB v42 while the connected client is v41.
- Final `detect_changes(scope: all)` was attempted with this worktree and failed for the same v42/v41 mismatch.

## Files

- `tools/dev/sandbox.sh` — one shared isolated runtime env; owned `restart-engine` lifecycle; direct built-engine launch from repo root; append-only log output; identity re-recording; usage/dispatch.
- `tools/dev/sandbox_guard_test.sh` — fake-process ownership refusal and full replacement/down cleanup checks without live ports.
- `apps/api_server/src/__tests__/issue_1457_global_stream_retry_live_e2e.test.ts` — explicit degradation, supported replacement, stable API identity, changed engine identity, bridge recovery, real WS `session.created`, and persisted child proof.
- `apps/api_server/src/__tests__/issue_1325_live_e2e.test.ts` — explicit supported replacement with stable API identity and changed engine identity before bridge recovery.
- `apps/api_server/src/contract/issue_1457_1325_restart_harness.test.ts` — prevents either live test from regressing to waiting for a nonexistent replacement.
- `docs/ai/contracts/issue-{1457,1325}.json` — repaired harness criteria and pending serial-live status.

## Checks

- `bash tools/dev/sandbox_guard_test.sh` — **PASS: 17 passed, 0 failed**.
- Maintained #1457 command (`sandbox_guard_test.sh` + contract/static/live-gated files) — **PASS: 9 passed, 1 skipped**.
- Maintained #1325 Vitest command — **PASS: 7 passed, 2 skipped**.
- Both live files under normal invocation skip cleanly.
- Each live file forced with `RHYTHM_LIVE_E2E=1` but without `RHYTHM_LIVE_E2E_ISOLATED`/`DB_PATH` — **expected nonzero**, isolation guard failure observed before network access.
- All S2 focused files, including the new three-test harness contract: **154 passed, 5 skipped** (151-pass baseline plus 3 new tests).
- `node_modules/.bin/tsc --noEmit` — **PASS**, no output.
- `npm run build` — **PASS** (`tsc -p tsconfig.json` and postbuild advisory copy).
- `bash -n tools/dev/sandbox.sh tools/dev/sandbox_guard_test.sh` — **PASS**.
- `git diff --check` — **PASS**.

Focused aggregate command:

```bash
cd apps/api_server
npx vitest run src/contract/issue_1457_global_stream_retry.test.ts src/contract/issue_1458_bypass_engine_permission.test.ts src/contract/issue_1455_1456_idle_finalization.test.ts src/contract/issue_1325_engine_respawn.test.ts src/contract/issue_1457_1325_restart_harness.test.ts src/__tests__/opencode_stream_bridge.test.ts src/__tests__/opencode_client_service.test.ts src/__tests__/issue_1379_bridge_hub_publish.test.ts src/__tests__/agent_sessions.test.ts src/__tests__/issue_1325_live_e2e.test.ts src/__tests__/issue_1457_global_stream_retry_live_e2e.test.ts src/__tests__/issue_1458_bypass_engine_permission_live_e2e.test.ts src/__tests__/issue_1455_1456_idle_finalization_live_e2e.test.ts
```

Fail-closed probes used `env -u RHYTHM_LIVE_E2E_ISOLATED -u DB_PATH RHYTHM_LIVE_E2E=1 npx vitest run <live-file>` separately for #1457 and #1325. Static gates were `node_modules/.bin/tsc --noEmit`, `npm run build`, `bash -n tools/dev/sandbox.sh tools/dev/sandbox_guard_test.sh`, and `git diff --check`.

## Handoff

- `restart-engine` verifies the recorded API process belongs to this sandbox, refuses unowned engine processes, preserves api_server, waits for the engine port to clear, launches the exact built fork with the shared isolated env and CORS, waits for `/global/health`, and rewrites the owned engine PID record.
- #1457 now proves post-recovery event and persistence traffic rather than HTTP health alone; it deletes only its generated child and parent in `finally`.
- Ready for S5's third serial live gate. The live criteria remain `UNVERIFIED` until that sandbox run records observable recovery.
