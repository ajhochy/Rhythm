---
date: 2026-08-15
repo: Rhythm
branch: codex/react-electron-live-suite
pr: null
issues: [post-m1-phase-8]
status: partial
tags: [run, Rhythm]
---

# Post-M1 Phase 8 acceptance-contract RED run

## Files

- `apps/api_server/src/__tests__/post_m1_phase_8_live_artifacts.test.ts`
- `apps/electron/test/post-m1-phase-8-artifact-policy.test.mjs`
- `apps/web/tests/post-m1-phase-8-fixture-playwright.config.ts`
- `apps/web/tests/post-m1-phase-8-live-artifacts.redspec.ts`
- `apps/web/tests/post-m1-phase-8-html-import.redspec.ts`
- `apps/web/tests/gateway/post-m1-phase-8-live-artifacts.live.redspec.ts`
- `apps/web/tests/gateway/post-m1-phase-8-html-import.live.redspec.ts`
- `docs/ai/contracts/post-m1-phase-8.json`
- `docs/ai/runs/2026-08-15-post-m1-phase-8-red.md`

No product source was changed. No file listed in `apps/web/SHA256SUMS` was modified; all five new web paths returned `NOT_LISTED` from the exact-name check.

## Routes verified before assertions

- `GET /live-artifacts?type=html`, `POST /live-artifacts`, `GET /live-artifacts/:id`, `GET /live-artifacts/:id/render`, `GET|POST /live-artifacts/:id/collaborators`, `DELETE /live-artifacts/:id/collaborators/:userId`, `PUT /live-artifacts/:id/state`, `PUT /live-artifacts/:id/bundle`, `PATCH|DELETE /live-artifacts/:id`, and `POST /live-artifacts/:id/capabilities/pco.services.read`: `apps/api_server/src/routes/live_artifacts_routes.ts:9-21`.
- `GET /users` and `PATCH /users/me/preferences`: `apps/api_server/src/routes/users_routes.ts:8-10`.
- API `GET /health`: `apps/api_server/src/routes/health_routes.ts:6-8`, mounted at `apps/api_server/src/app.ts:130`.
- Engine `GET /global/health`: `apps/opencode_fork/packages/opencode/src/server/routes/instance/httpapi/groups/global.ts:38-44`.
- Router mounts: `apps/api_server/src/app.ts:144,148`.

## Checks

### API contract — PASS

Command:

```text
cd apps/api_server && npx vitest run src/__tests__/post_m1_phase_8_live_artifacts.test.ts --no-file-parallelism
```

Verbatim output:

```text

 RUN  v4.1.1 /Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite/apps/api_server


 Test Files  1 passed (1)
      Tests  4 passed (4)
   Start at  19:54:01
   Duration  5.19s (transform 3.63s, setup 0ms, import 4.39s, tests 651ms, environment 0ms)
```

Disposition: `post-m1-p8-c2a`, `post-m1-p8-c2c`, `post-m1-p8-c2d`, and `post-m1-p8-c2e` are `pass`; the API already satisfies them.

### Electron bridge policy — RED by assertion

Command:

```text
cd apps/electron && node --test test/post-m1-phase-8-artifact-policy.test.mjs
```

Verbatim output:

```text
TAP version 13
# Subtest: post-m1-p8-c4a: artifact policy exposes only the closed canonical bridge operations
not ok 1 - post-m1-p8-c4a: artifact policy exposes only the closed canonical bridge operations
  ---
  duration_ms: 0.725542
  type: 'test'
  location: '/Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite/apps/electron/test/post-m1-phase-8-artifact-policy.test.mjs:7:1'
  failureType: 'testCodeFailure'
  error: 'post-m1-p8-c4a: Electron has no artifact-specific policy module'
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: ~
  actual: ~
  operator: 'notStrictEqual'
  stack: |-
    TestContext.<anonymous> (file:///Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite/apps/electron/test/post-m1-phase-8-artifact-policy.test.mjs:10:10)
    Test.runInAsyncScope (node:async_hooks:214:14)
    Test.run (node:internal/test_runner/test:1047:25)
    Test.start (node:internal/test_runner/test:944:17)
    startSubtestAfterBootstrap (node:internal/test_runner/harness:296:17)
  ...
# Subtest: post-m1-p8-c4b: artifact bridge policy binds nonce, request IDs, payload, concurrency, and generation
not ok 2 - post-m1-p8-c4b: artifact bridge policy binds nonce, request IDs, payload, concurrency, and generation
  ---
  duration_ms: 0.177834
  type: 'test'
  location: '/Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite/apps/electron/test/post-m1-phase-8-artifact-policy.test.mjs:32:1'
  failureType: 'testCodeFailure'
  error: 'post-m1-p8-c4b: Electron has no artifact-specific policy module'
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: ~
  actual: ~
  operator: 'notStrictEqual'
  stack: |-
    TestContext.<anonymous> (file:///Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite/apps/electron/test/post-m1-phase-8-artifact-policy.test.mjs:35:10)
    Test.runInAsyncScope (node:async_hooks:214:14)
    Test.run (node:internal/test_runner/test:1047:25)
    Test.processPendingSubtests (node:internal/test_runner/test:744:18)
    Test.run (node:internal/test_runner/test:1101:12)
    async startSubtestAfterBootstrap (node:internal/test_runner/harness:296:3)
  ...
1..2
# tests 2
# suites 0
# pass 0
# fail 2
# cancelled 0
# skipped 0
# todo 0
# duration_ms 72.186209
```

Disposition: `post-m1-p8-c4a` and `post-m1-p8-c4b` are genuine `red`. The dynamic import is caught, both tests run, and both fail assertions because the product policy module is absent.

### Playwright collection only — 10 tests collected, not executed

Command:

```text
cd apps/web && npx playwright test --config tests/post-m1-phase-8-fixture-playwright.config.ts --list
```

Verbatim output:

```text
Listing tests:
  gateway/post-m1-phase-8-html-import.live.redspec.ts:16:1 › post-m1-p8-c5b: confirmed import creates one canonical private artifact, then opens and persists its stable id
  gateway/post-m1-phase-8-live-artifacts.live.redspec.ts:80:1 › post-m1-p8-c1a: typed live-artifact gateway uses authenticated canonical catalog, detail, and render routes
  gateway/post-m1-phase-8-live-artifacts.live.redspec.ts:107:1 › post-m1-p8-c1d: ordered artifactTabIds restore per identity while Dashboard stays initially selected
  gateway/post-m1-phase-8-live-artifacts.live.redspec.ts:142:1 › post-m1-p8-c1f: current bundle metadata and bounded reload recovery remain bound to one stable id
  gateway/post-m1-phase-8-live-artifacts.live.redspec.ts:179:1 › post-m1-p8-c2b: canonical sharing controls are owner-only and mutate visibility plus numeric collaborators
  gateway/post-m1-phase-8-live-artifacts.live.redspec.ts:216:1 › post-m1-p8-c4g: pco.services.read is declared, exact-shape, current-viewer bound, and bounded
  post-m1-phase-8-html-import.redspec.ts:40:1 › post-m1-p8-c5a: local HTML import validates format, bytes, UTF-8, title preview, source preservation, and warnings
  post-m1-phase-8-live-artifacts.redspec.ts:67:1 › post-m1-p8-c1b: Dashboard is fixed while stable artifact tabs open, select, and close without deletion
  post-m1-phase-8-live-artifacts.redspec.ts:83:1 › post-m1-p8-c1c: the HTML picker exposes canonical search and the complete bounded state matrix
  post-m1-phase-8-live-artifacts.redspec.ts:121:1 › post-m1-p8-c1e: artifact tabs preserve overflow reachability and complete keyboard/focus semantics
Total: 10 tests in 4 files
```

Per the unit constraint, Chromium was not launched. These ten criteria remain `pending`, not `red`, until the orchestrator runs them and observes assertion failures.

### Web TypeScript — PASS

Command:

```text
cd apps/web && npx tsc --noEmit --pretty false
```

Verbatim output: empty; exit 0.

### Residue and engine profile — PASS

Verbatim output:

```text
rows=0
sessions=0
worktrees=0
branches=0
id          oc_agent    model_provider  model_id            
----------  ----------  --------------  --------------------
local-lean  local-lean  omlx            gpt-oss-20b-MXFP4-Q8
lmstudio_auth=false
```

The managed sandbox remained up on API `:4098`, engine `:4097`, and gateway `:4099`; this unit did not restart or hand-launch any server.

## Pending without weakened tests

- `post-m1-p8-c3a`–`post-m1-p8-c3d`: require a real engine/MCP mutation and authenticated Electron observation. Existing API-only evidence does not satisfy the combined criteria.
- `post-m1-p8-c4c`–`post-m1-p8-c4f`: require packaged hostile-content observation. A new product-only smoke receipt or `window.__…` hook was explicitly prohibited, and this unit was forbidden to launch Electron.
