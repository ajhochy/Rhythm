---
date: 2026-08-15
repo: Rhythm-react-electron-live-suite
branch: null
pr: null
issues: [post-m1-phase-7]
status: partial
tags: [run, Rhythm-react-electron-live-suite]
---

# Post-M1 Phase 7 acceptance RED

## Files

- Added six `apps/web/tests/post-m1-phase-7-*.redspec.ts` files, one live interception helper, and one explicit Playwright config. These are new files and are not listed in `apps/web/SHA256SUMS`.
- Added three `apps/api_server/src/__tests__/post_m1_phase_7_*.test.ts` contract files.
- Added two non-GUI Electron host contract files under `apps/electron/test/`.
- Updated `docs/ai/contracts/post-m1-phase-7.json` with observed dispositions.
- No product source file was edited.

## Checks

### Playwright collection only

Command:

```text
cd apps/web && npx playwright test --config tests/post-m1-phase-7-fixture-playwright.config.ts --list
```

Observed output (verbatim):

```text
Listing tests:
  post-m1-phase-7-approvals.redspec.ts:4:1 › post-m1-p7-c4d: pending approval card signs an exact approved/rejected decision and focuses its owned session
  post-m1-phase-7-memory.redspec.ts:26:1 › post-m1-p7-c1a: live memory list and search round-trip the canonical persisted row
  post-m1-phase-7-memory.redspec.ts:46:1 › post-m1-p7-c1b: live memory renders canonical provenance verification lifecycle and trust fields
  post-m1-phase-7-notifications.redspec.ts:9:1 › post-m1-p7-c4b: live notifications derive recipient-scoped unread badge read state and owned navigation
  post-m1-phase-7-notifications.redspec.ts:31:1 › post-m1-p7-c4c: notification.push is deduplicated by numeric id without losing concurrent session events
  post-m1-phase-7-playbooks-cookbook.redspec.ts:4:1 › post-m1-p7-c2e: live managed playbook refreshes the engine catalog and becomes slash-command available
  post-m1-phase-7-playbooks-cookbook.redspec.ts:24:1 › post-m1-p7-c2f: live cookbook persists stepsJson and boundConfigId then opens the returned owned session
  post-m1-phase-7-research-gallery.redspec.ts:22:1 › post-m1-p7-c2a: live research CRUD submits and preserves every canonical project field
  post-m1-phase-7-research-gallery.redspec.ts:59:1 › post-m1-p7-c2c: selected live research run exposes evidence recovery export and discussion contracts
  post-m1-phase-7-research-gallery.redspec.ts:81:1 › post-m1-p7-c2d: Gallery browses authorized rows opens the real artifact and launches from canonical context
  post-m1-phase-7-schedules-quality.redspec.ts:13:1 › post-m1-p7-c2g: live scheduled-task CRUD trigger preserves canonical recurrence profile model and allowlists
  post-m1-phase-7-schedules-quality.redspec.ts:30:1 › post-m1-p7-c2h: durable schedule history uses canonical run rows and owned rootSessionId navigation
  post-m1-phase-7-schedules-quality.redspec.ts:48:1 › post-m1-p7-c2i: live report card renders nullable and unmeasured owner-scoped run evidence
Total: 13 tests in 6 files
```

Chromium was not launched. Collection is not recorded as RED.

### API contract tests

Command:

```text
cd apps/api_server && npx vitest run src/__tests__/post_m1_phase_7_memory_contract.test.ts src/__tests__/post_m1_phase_7_runs_contract.test.ts src/__tests__/post_m1_phase_7_notifications_contract.test.ts --no-file-parallelism
```

First run exposed two fixture foreign-key errors. Relevant output (verbatim):

```text
Test Files  2 failed | 1 passed (3)
     Tests  2 failed | 4 passed (6)

FAIL  src/__tests__/post_m1_phase_7_memory_contract.test.ts > post-m1 Phase 7 canonical memory persistence contract > post-m1-p7-c1c-api: owner-scoped list/search preserve canonical IDs and instance-global retrieval policy
SqliteError: FOREIGN KEY constraint failed
 ❯ AgentMemoryRepository.createAsync src/repositories/agent_memory_repository.ts:255:8

FAIL  src/__tests__/post_m1_phase_7_runs_contract.test.ts > post-m1 Phase 7 research, quality, and bounded-discovery contracts > post-m1-p7-c2i-api: owner-scoped run-quality keeps thin-history rates null and counts unmeasured runs
SqliteError: FOREIGN KEY constraint failed
```

Repair loop 1 created real owner rows. The next run reached one assertion and showed that canonical `idle` is completed and `working` is in progress, not unmeasured. Relevant output (verbatim):

```text
Test Files  1 failed | 2 passed (3)
     Tests  1 failed | 5 passed (6)

FAIL  src/__tests__/post_m1_phase_7_runs_contract.test.ts > post-m1 Phase 7 research, quality, and bounded-discovery contracts > post-m1-p7-c2i-api: owner-scoped run-quality keeps thin-history rates null and counts unmeasured runs
AssertionError: expected 0 to be greater than 0
 ❯ src/__tests__/post_m1_phase_7_runs_contract.test.ts:88:45
```

Repair loop 2 removed the noncanonical assumption and asserted the canonical counters. Final output (verbatim):

```text
 RUN  v4.1.1 /Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite/apps/api_server


 Test Files  3 passed (3)
      Tests  6 passed (6)
   Start at  19:53:20
   Duration  2.71s (transform 1.42s, setup 0ms, import 602ms, tests 1.82s, environment 0ms)
```

### Electron non-GUI RED contracts

Command:

```text
cd apps/electron && node --test test/post-m1-phase-7-native-notifications.test.mjs test/post-m1-phase-7-packaged-notifications.test.mjs
```

The first execution produced the same two assertion failures but Node embedded all of `main.mjs` as the failed `assert.match` value (10,638 output tokens; tool capture truncated it). Assertions were changed to equivalent boolean predicates solely to bound evidence. Final output (verbatim):

```text
TAP version 13
# Subtest: post-m1-p7-c4e: Electron owns permission presentation deduplication cancellation and a narrow preload
not ok 1 - post-m1-p7-c4e: Electron owns permission presentation deduplication cancellation and a narrow preload
  ---
  duration_ms: 0.702125
  type: 'test'
  location: '/Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite/apps/electron/test/post-m1-phase-7-native-notifications.test.mjs:11:1'
  failureType: 'testCodeFailure'
  error: 'Electron main must own the native Notification primitive'
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: true
  actual: false
  operator: '=='
  stack: |-
    TestContext.<anonymous> (file:///Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite/apps/electron/test/post-m1-phase-7-native-notifications.test.mjs:14:10)
    Test.runInAsyncScope (node:async_hooks:214:14)
    Test.run (node:internal/test_runner/test:1047:25)
    Test.start (node:internal/test_runner/test:944:17)
    startSubtestAfterBootstrap (node:internal/test_runner/harness:296:17)
  ...
# Subtest: post-m1-p7-c4f-policy: native activation is allowlisted queued and replayed through owned-target navigation
not ok 2 - post-m1-p7-c4f-policy: native activation is allowlisted queued and replayed through owned-target navigation
  ---
  duration_ms: 0.64375
  type: 'test'
  location: '/Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite/apps/electron/test/post-m1-phase-7-packaged-notifications.test.mjs:10:1'
  failureType: 'testCodeFailure'
  error: 'the host must retain early native activations until the renderer is ready'
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: true
  actual: false
  operator: '=='
  stack: |-
    TestContext.<anonymous> (file:///Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite/apps/electron/test/post-m1-phase-7-packaged-notifications.test.mjs:14:10)
    Test.runInAsyncScope (node:async_hooks:214:14)
    Test.run (node:internal/test_runner/test:1047:25)
    Test.start (node:internal/test_runner/test:944:17)
    startSubtestAfterBootstrap (node:internal/test_runner/harness:296:17)
  ...
1..2
# tests 2
# suites 0
# pass 0
# fail 2
# cancelled 0
# skipped 0
# todo 0
# duration_ms 51.880917
```

No Electron process, packaged app, or GUI was launched.

### Contract/checksum/residue

Observed output (verbatim):

```text
contract JSON valid
sandbox: /var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T//rhythm-dev-sandbox
live-artifact storage: /var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T//rhythm-dev-sandbox/live-artifacts
api :4098 listener: 27366
engine :4097 listener: 27394
gateway :4099 listener: 27366
rows=0
sessions=0
worktrees=0
branches=0
```

`grep -nE 'post-m1-phase-7|post_m1_phase_7' apps/web/SHA256SUMS` printed nothing. The sandbox auth document has no `lmstudio` entry. This unit did not mutate engine/provider settings.

## Routes verified

- `/agent-memory` GET/POST and `/agent-memory/search` GET: `apps/api_server/src/routes/agentMemoryRoutes.ts:18-24`; PATCH/DELETE by canonical ID: `:38-39`; mount: `apps/api_server/src/app.ts:219`.
- `/agent-research/projects` GET/POST, project runs GET/POST, magazine/export/discussion/detail: `apps/api_server/src/routes/agentResearchRoutes.ts:11-21`; mount: `apps/api_server/src/app.ts:225`.
- `/agent-designs` GET and `/:id/artifact` GET: `apps/api_server/src/routes/agentDesignsRoutes.ts:11-15`; mount: `apps/api_server/src/app.ts:235`.
- `/opencode/commands` GET and `/:name/content` GET: `apps/api_server/src/routes/opencode_commands_routes.ts:43-69`; mount: `apps/api_server/src/app.ts:274`.
- `/agent-cookbook` GET/POST and `/:id/run` POST: `apps/api_server/src/routes/agentCookbookRoutes.ts:11-16`; mount: `apps/api_server/src/app.ts:226`.
- `/agent-schedules` GET/POST, `/:id/runs` GET, and `/:id/trigger-now` POST: `apps/api_server/src/routes/agentSchedulesRoutes.ts:11-17`; mount: `apps/api_server/src/app.ts:212`.
- `/agents/run-quality` GET: `apps/api_server/src/routes/run_quality_routes.ts:23`; mount: `apps/api_server/src/app.ts:207`.
- `/notifications` GET, `/read-all` POST, and `/:id/read` POST: `apps/api_server/src/routes/notifications_routes.ts:11-13`; `/notifications/agent` mount: `apps/api_server/src/app.ts:154-157` and POST declaration: `apps/api_server/src/routes/notifications_agent_routes.ts:9`.
- `/agent-approvals` GET and `/:id` PATCH: `apps/api_server/src/routes/agent_approvals_routes.ts:43-53`; mount: `apps/api_server/src/app.ts:205`.
- `/agent-sessions` GET/POST and `/:id` GET: `apps/api_server/src/routes/agent_sessions_routes.ts:65-67`; mount: `apps/api_server/src/app.ts:236`.

## Notes

- API sub-contracts pass and prevent React implementation from inventing display vocabulary.
- Renderer specs deliberately use live Vite mode plus Playwright route/WebSocket interception; no product-only browser hook is required.
- Full real-engine research, memory restart/update/forget, schedule restart/quarantine, cross-runner authorization, and packaged native activation remain pending. They were not manufactured as RED through skips, import crashes, or nonexistent endpoints.
