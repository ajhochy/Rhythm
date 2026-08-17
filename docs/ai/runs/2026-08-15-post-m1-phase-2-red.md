---
date: 2026-08-15
repo: Rhythm-react-electron-live-suite
branch: codex/react-electron-live-suite
pr: null
issues: [post-m1-phase-2]
status: partial
tags: [run, rhythm-react-electron-live-suite]
---

# Post-M1 Phase 2 RED contract

## Files

- `apps/web/tests/post-m1-phase-2-fixture-playwright.config.ts`
- `apps/web/tests/post-m1-phase-2-profiles.redspec.ts`
- `apps/web/tests/post-m1-phase-2-profile-security.redspec.ts`
- `apps/api_server/src/__tests__/post_m1_phase_2_profile_contract.test.ts`
- `apps/api_server/src/__tests__/post_m1_phase_2_ownership_contract.test.ts`
- `apps/api_server/src/__tests__/post_m1_phase_2_profile_restart_live_e2e.test.ts`
- `docs/ai/contracts/post-m1-phase-2.json`
- `docs/ai/runs/2026-08-15-post-m1-phase-2-red.md`

No product file, Electron file, tool, protected parity source, branch, commit, or worktree was changed.

## Checks

### Playwright collection only — PASS

Command (run twice after authoring and after the packaged-test rewrite; final output shown verbatim):

```bash
cd apps/web
npx playwright test --config tests/post-m1-phase-2-fixture-playwright.config.ts --list
```

```text
Listing tests:
  post-m1-phase-2-profile-security.redspec.ts:56:3 › packaged Phase 2 profile/provider security › post-m1-p2-c4a: packaged profile CRUD exposes only approved gateway operations
  post-m1-phase-2-profile-security.redspec.ts:71:3 › packaged Phase 2 profile/provider security › post-m1-p2-c4b: packaged profile/provider rendering bounds and redacts failures
  post-m1-phase-2-profile-security.redspec.ts:80:3 › packaged Phase 2 profile/provider security › post-m1-p2-c4c: packaged preload and diagnostics expose no secret-bearing surface
  post-m1-phase-2-profiles.redspec.ts:30:1 › post-m1-p2-c1a: list and selection preserve canonical profile and model identifiers
  post-m1-phase-2-profiles.redspec.ts:46:1 › post-m1-p2-c1b: create posts canonical modelProvider/modelId and adopts the server id
  post-m1-phase-2-profiles.redspec.ts:74:1 › post-m1-p2-c1c: edit patches canonical nullable model fields without display aliases
  post-m1-phase-2-profiles.redspec.ts:101:1 › post-m1-p2-c1d: selected profileId stays distinct from local and SDK session ids
Total: 7 tests in 2 files
```

Chromium was not launched. The c1 tests are collected for orchestrator execution. The c4 tests are also gated by `RHYTHM_PACKAGED_PROFILE_E2E=1` and were deliberately not run.

### First focused API run — one valid RED plus one harness failure

Command:

```bash
cd apps/api_server
npx vitest run src/__tests__/post_m1_phase_2_profile_contract.test.ts src/__tests__/post_m1_phase_2_ownership_contract.test.ts --no-file-parallelism
```

```text
 RUN  v4.1.1 /Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite/apps/api_server

stdout | src/__tests__/post_m1_phase_2_ownership_contract.test.ts > post-m1 Phase 2 actual profile access contract > post-m1-p2-c3c: AGENT_LOCAL grants tokenless CRUD only through the loopback guard
backfill_scheduled_date_v1: tasks updated=0, project_steps updated=0

stderr | src/__tests__/post_m1_phase_2_ownership_contract.test.ts > post-m1 Phase 2 actual profile access contract > post-m1-p2-c3c: AGENT_LOCAL grants tokenless CRUD only through the loopback guard
[WARN] [AgentConfigsController] agent-profile config reload did not complete

 ❯ src/__tests__/post_m1_phase_2_ownership_contract.test.ts (3 tests | 1 failed) 1776ms
     × post-m1-p2-c3c: AGENT_LOCAL grants tokenless CRUD only through the loopback guard 87ms
stdout | src/__tests__/post_m1_phase_2_profile_contract.test.ts > post-m1 Phase 2 canonical profile API contract > post-m1-p2-c1b-api: create persists API modelProvider/modelId as DB model_provider/model_id
backfill_scheduled_date_v1: tasks updated=0, project_steps updated=0

stderr | src/__tests__/post_m1_phase_2_profile_contract.test.ts > post-m1 Phase 2 canonical profile API contract > post-m1-p2-c1b-api: create persists API modelProvider/modelId as DB model_provider/model_id
[WARN] [AgentConfigsController] agent-profile config reload did not complete

 ❯ src/__tests__/post_m1_phase_2_profile_contract.test.ts (2 tests | 1 failed) 441ms
     × post-m1-p2-c1b-api: create persists API modelProvider/modelId as DB model_provider/model_id 380ms

 Failed Tests 2

 FAIL  src/__tests__/post_m1_phase_2_ownership_contract.test.ts > post-m1 Phase 2 actual profile access contract > post-m1-p2-c3c: AGENT_LOCAL grants tokenless CRUD only through the loopback guard
AssertionError: expected 200 to be 403 // Object.is equality

- Expected
+ Received

- 403
+ 200

 ❯ src/__tests__/post_m1_phase_2_ownership_contract.test.ts:165:32

 FAIL  src/__tests__/post_m1_phase_2_profile_contract.test.ts > post-m1 Phase 2 canonical profile API contract > post-m1-p2-c1b-api: create persists API modelProvider/modelId as DB model_provider/model_id
AssertionError: expected { …(30) } to match object { …(18) }
(12 matching properties omitted from actual)

- Expected
+ Received

@@ -13,8 +13,8 @@
   "modelId": "claude-sonnet-4-6",
   "modelProvider": "anthropic",
   "modelTierHint": null,
   "ocAgent": "phase-2-canonical-create",
   "sessionSelectable": true,
-  "sortOrder": 42,
+  "sortOrder": 0,
   "systemPrompt": "Preserve canonical identity.",

 Test Files  2 failed (2)
      Tests  2 failed | 3 passed (5)
```

The c3c result was not accepted as RED. Node `fetch` replaced the restricted `Host` header, so that request never exercised the hostile-host guard. The harness was repaired to use `node:http`; the assertion stayed unchanged. The c1b failure was retained as real RED.

### Ownership contract after harness repair — PASS

Command:

```bash
cd apps/api_server
npx vitest run src/__tests__/post_m1_phase_2_ownership_contract.test.ts --no-file-parallelism
```

```text
 RUN  v4.1.1 /Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite/apps/api_server

 Test Files  1 passed (1)
      Tests  3 passed (3)
   Start at  15:20:49
   Duration  1.76s (transform 1.10s, setup 0ms, import 51ms, tests 1.63s, environment 0ms)
```

### Profile API contract isolated — RED

Command:

```bash
cd apps/api_server
npx vitest run src/__tests__/post_m1_phase_2_profile_contract.test.ts --no-file-parallelism
```

```text
 RUN  v4.1.1 /Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite/apps/api_server

stdout | src/__tests__/post_m1_phase_2_profile_contract.test.ts > post-m1 Phase 2 canonical profile API contract > post-m1-p2-c1b-api: create persists API modelProvider/modelId as DB model_provider/model_id
backfill_scheduled_date_v1: tasks updated=0, project_steps updated=0

stderr | src/__tests__/post_m1_phase_2_profile_contract.test.ts > post-m1 Phase 2 canonical profile API contract > post-m1-p2-c1b-api: create persists API modelProvider/modelId as DB model_provider/model_id
[WARN] [AgentConfigsController] agent-profile config reload did not complete

 ❯ src/__tests__/post_m1_phase_2_profile_contract.test.ts (2 tests | 1 failed) 1553ms
     × post-m1-p2-c1b-api: create persists API modelProvider/modelId as DB model_provider/model_id 1493ms

 Failed Tests 1

 FAIL  src/__tests__/post_m1_phase_2_profile_contract.test.ts > post-m1 Phase 2 canonical profile API contract > post-m1-p2-c1b-api: create persists API modelProvider/modelId as DB model_provider/model_id
AssertionError: expected { …(30) } to match object { …(18) }
(12 matching properties omitted from actual)

- Expected
+ Received

@@ -13,8 +13,8 @@
   "modelId": "claude-sonnet-4-6",
   "modelProvider": "anthropic",
   "modelTierHint": null,
   "ocAgent": "phase-2-canonical-create",
   "sessionSelectable": true,
-  "sortOrder": 42,
+  "sortOrder": 0,
   "systemPrompt": "Preserve canonical identity.",

 Test Files  1 failed (1)
      Tests  1 failed | 1 passed (2)
   Start at  15:20:55
   Duration  1.67s (transform 1.11s, setup 0ms, import 39ms, tests 1.55s, environment 0ms)
```

This is a direct assertion failure after real HTTP POST and DB persistence. The assertion was not weakened.

### Live restart attempt — HARNESS FAILURE, not RED

Command:

```bash
cd apps/api_server
RHYTHM_LIVE_E2E=1 npx vitest run src/__tests__/post_m1_phase_2_profile_restart_live_e2e.test.ts --no-file-parallelism
```

```text
 RUN  v4.1.1 /Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite/apps/api_server

sandbox: sandbox API port :4098 is still occupied
sandbox: sandbox API port :4098 is still occupied
 ❯ src/__tests__/post_m1_phase_2_profile_restart_live_e2e.test.ts (4 tests | 4 skipped) 484ms

 Failed Suites 1

 FAIL  src/__tests__/post_m1_phase_2_profile_restart_live_e2e.test.ts > post-m1 Phase 2 persisted profile restart behavior
Error: Command failed: /Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite/tools/dev/sandbox.sh restart
sandbox: sandbox API port :4098 is still occupied

 ❯ restartSandbox src/__tests__/post_m1_phase_2_profile_restart_live_e2e.test.ts:127:18

 FAIL  src/__tests__/post_m1_phase_2_profile_restart_live_e2e.test.ts > post-m1 Phase 2 persisted profile restart behavior
TypeError: fetch failed

Caused by: Error: connect ECONNREFUSED 127.0.0.1:4097

 Test Files  1 failed (1)
      Tests  4 skipped (4)
   Start at  15:21:00
   Duration  617ms (transform 24ms, setup 0ms, import 55ms, tests 484ms, environment 0ms)
```

Classification: environment/harness. No c2 criterion reached an assertion, so c2 remains pending. The authored test was then changed to use the sandbox's existing authenticated `openai/gpt-5.6-terra` route, avoiding temporary auth mutation and engine-PID invalidation. Its restart assertion was not weakened.

### Live file collection/compile with gate off — PASS, criterion not run

Command:

```bash
cd apps/api_server
npx vitest run src/__tests__/post_m1_phase_2_profile_restart_live_e2e.test.ts --no-file-parallelism
```

```text
 RUN  v4.1.1 /Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite/apps/api_server

 Test Files  1 skipped (1)
      Tests  4 skipped (4)
   Start at  15:22:39
   Duration  125ms (transform 22ms, setup 0ms, import 45ms, tests 0ms, environment 0ms)
```

This proves only collection/compilation. It is not recorded as RED or PASS for c2.

### Final focused API disposition — 1 RED, 4 PASS

Command:

```bash
cd apps/api_server
npx vitest run src/__tests__/post_m1_phase_2_profile_contract.test.ts src/__tests__/post_m1_phase_2_ownership_contract.test.ts --no-file-parallelism
```

```text
 RUN  v4.1.1 /Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite/apps/api_server

stdout | src/__tests__/post_m1_phase_2_profile_contract.test.ts > post-m1 Phase 2 canonical profile API contract > post-m1-p2-c1b-api: create persists API modelProvider/modelId as DB model_provider/model_id
backfill_scheduled_date_v1: tasks updated=0, project_steps updated=0

stderr | src/__tests__/post_m1_phase_2_profile_contract.test.ts > post-m1 Phase 2 canonical profile API contract > post-m1-p2-c1b-api: create persists API modelProvider/modelId as DB model_provider/model_id
[WARN] [AgentConfigsController] agent-profile config reload did not complete

 ❯ src/__tests__/post_m1_phase_2_profile_contract.test.ts (2 tests | 1 failed) 1558ms
     × post-m1-p2-c1b-api: create persists API modelProvider/modelId as DB model_provider/model_id 1494ms

 Failed Tests 1

 FAIL  src/__tests__/post_m1_phase_2_profile_contract.test.ts > post-m1 Phase 2 canonical profile API contract > post-m1-p2-c1b-api: create persists API modelProvider/modelId as DB model_provider/model_id
AssertionError: expected { …(30) } to match object { …(18) }
(12 matching properties omitted from actual)

- Expected
+ Received

@@ -13,8 +13,8 @@
   "modelId": "claude-sonnet-4-6",
   "modelProvider": "anthropic",
   "modelTierHint": null,
   "ocAgent": "phase-2-canonical-create",
   "sessionSelectable": true,
-  "sortOrder": 42,
+  "sortOrder": 0,
   "systemPrompt": "Preserve canonical identity.",

 Test Files  1 failed | 1 passed (2)
      Tests  1 failed | 4 passed (5)
   Start at  15:25:40
   Duration  2.34s (transform 1.13s, setup 0ms, import 68ms, tests 2.11s, environment 0ms)
```

## Cleanup and residue

Final verification output:

```text
RESIDUE rows=0 sessions=0 worktrees=0 branches=0
{"id":"local-lean","modelProvider":"omlx","modelId":"gpt-oss-20b-MXFP4-Q8"}
{"lmstudio":null,"providers":["openrouter","anthropic","openai","google","ollama-planner","ollama-executor","opencode"]}
{"localLean":"omlx/gpt-oss-20b-MXFP4-Q8"}
provider1234=clear
```

The sandbox remains up. `local-lean` is restored in the API and engine projection, no `lmstudio` auth entry remains, no temporary provider listener remains, and no nonce row/session/worktree/branch remains.

## Notes

- c3 records the actual global-per-install profile design. No ownership column or fictitious workspace policy was added.
- c3d is `not_tested` with the required reopen condition.
- The c4 packaged test is written under `apps/web/tests/` and collected, but was not executed because launching the packaged application is prohibited in this dispatch path.
- Failure-triage result: `BLOCKED — cannot execute the managed API+engine restart in this restricted process sandbox; requires orchestrator execution with permission to signal the sandbox processes.`
