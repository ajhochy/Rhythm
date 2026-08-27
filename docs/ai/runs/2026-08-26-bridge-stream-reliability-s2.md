---
date: 2026-08-26
repo: Rhythm
branch: fix/bridge-stream-reliability
pr: pending
issues: [1457, 1458, 1455, 1456, 1325]
status: ready_for_verification
tags: [run, Rhythm]
---

# Bridge stream reliability — S2

## Files

- `apps/api_server/src/services/opencode_stream_bridge.ts`
- `apps/api_server/src/services/opencode_client_service.ts`
- `apps/api_server/src/services/opencode_health.ts`
- `apps/api_server/src/contract/issue_1457_global_stream_retry.test.ts`
- `apps/api_server/src/contract/issue_1458_bypass_engine_permission.test.ts`
- `apps/api_server/src/contract/issue_1455_1456_idle_finalization.test.ts`
- `apps/api_server/src/__tests__/issue_{1325,1457,1458,1455_1456}*_live_e2e.test.ts`
- `docs/ai/contracts/issue-{1325,1455,1456,1457,1458}.json`

## Phase 0 — failing contracts

- `npx vitest run src/contract/issue_1457_global_stream_retry.test.ts` — **FAIL**: 5 failed, 1 passed; no retry occurred after `ECONNRESET`.
- `npx vitest run src/contract/issue_1458_bypass_engine_permission.test.ts` — **FAIL**: 4 failed; session create body had no bypass permission policy.
- `npx vitest run src/contract/issue_1455_1456_idle_finalization.test.ts` — **FAIL**: 10 failed, 3 passed; part-updated-only turns emitted the generic empty error and stop reasons were absent.
- Existing #1325 contract was already green on `main`; this run strengthened its gated live engine-respawn behavior.

## Impact analysis

GitNexus `impact(direction: "upstream")` was invoked before implementation for:

- `ensureGlobalStream`
- `resubscribeGlobalStream`
- `_listenGlobal`
- `dispose`
- `createSession`
- `_relayEvent`
- `buildOpencodeHealthPayload`

The registered Rhythm index was 110 commits stale and returned `UNKNOWN`/symbol-not-found for each. `node .gitnexus/run.cjs analyze` rebuilt the index successfully (84,681 nodes / 167,575 edges), after which the connected MCP rejected it because its LadybugDB storage binary is v41 while the refreshed index is v42. No HIGH/CRITICAL result was returned. Every required `detect_changes(scope: "all")` attempt failed for the same v41/v42 mismatch; committed scope was reviewed with `git diff main...HEAD` instead.

## Checks

- Aggregate unit/contract suite:
  `npx vitest run src/contract/issue_1457_global_stream_retry.test.ts src/contract/issue_1458_bypass_engine_permission.test.ts src/contract/issue_1455_1456_idle_finalization.test.ts src/contract/issue_1325_engine_respawn.test.ts src/__tests__/opencode_stream_bridge.test.ts src/__tests__/opencode_client_service.test.ts src/__tests__/issue_1379_bridge_hub_publish.test.ts src/__tests__/issue_1325_live_e2e.test.ts src/__tests__/issue_1457_global_stream_retry_live_e2e.test.ts src/__tests__/issue_1458_bypass_engine_permission_live_e2e.test.ts src/__tests__/issue_1455_1456_idle_finalization_live_e2e.test.ts`
  — **PASS: 99 passed, 5 skipped** (live suites skipped by env gate).
- `node_modules/.bin/tsc --noEmit` — first run found a contract-only spy cast error; repaired, second run **PASS** with no output.
- Focused repair check: `npx vitest run src/contract/issue_1457_global_stream_retry.test.ts` — **PASS: 6/6**.

## Notes / handoff

- The shared sandbox was deliberately not started or restarted. No process was launched on ports 4098/4097/4096.
- Written live gates remain for serial operator verification with `RHYTHM_LIVE_E2E=1`; #1325/#1457 gates intentionally terminate only the isolated engine PID after asserting ports 4098/4097.
- #1458 unit coverage proves the engine receives wildcard `allow`, explicitly covering `external_directory`; the existing SSE auto-answer remains unchanged as the mid-flight fallback.
- #1325 production identity/liveness/staleness implementation was already present on `main`; this stream adds the missing live respawn assertion rather than duplicating production code.
