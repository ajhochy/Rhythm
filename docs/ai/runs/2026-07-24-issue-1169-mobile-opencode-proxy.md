---
date: 2026-07-24
repo: Rhythm
branch: codex/mobile-1169-proxy
pr: null
issues: [1169]
status: complete
tags: [run, Rhythm]
---

# Issue #1169 — allowlisted mobile OpenCode gateway

## Files

- Added `scripts/generate-mobile-opencode-operations.mjs`, generated operation
  types, and a manifest covering every operation in the bundled OpenAPI file.
  The final manifest contains 133 unique decisions: 89 allowed, 44 denied.
- Added `MobileOpenCodeProxy`: deny-by-default method/path matching, safe path
  decoding, recursive root/workspace stripping, server directory injection,
  realpath containment for file/session path queries, bounded raw requests,
  bounded streaming responses, full-response timeout, narrow header forwarding,
  and normalized upstream errors.
- Added authenticated `/mobile-gateway/opencode/*` routing after device auth and
  repository project resolution. Route-local errors never enter the diagnostic
  logger.
- Hardened the global error handler for mobile failures raised before the router
  (malformed/oversized JSON and CORS): stable 400/413 responses and metadata-only
  logging without URL, query, body, params, raw error, or stack.
- Added the `opencode-http-proxy` feature to the existing compatibility report.
- Extended project-root override rejection for workspace/workspaceID/roots and
  added a root-only proxy middleware so OpenCode operation `body.path` values
  are not misinterpreted as the project preflight path.
- Added the executable acceptance contract, comprehensive HTTP/service tests,
  an env-gated real-engine live test, postmortem, and current project state.

## Checks

### Acceptance proof

- Baseline RED: all eight offline #1169 tests failed before implementation;
  the live test was present and env-gated.
- Final focused:

  ```text
  npx vitest run \
    src/__tests__/issue_1169_mobile_opencode_proxy.test.ts \
    src/__tests__/issue_1169_mobile_opencode_proxy_live.test.ts \
    src/services/__tests__/mobile_pairing_service.test.ts \
    src/services/__tests__/mobile_project_scope.test.ts

  Test Files 3 passed | 1 skipped (4)
  Tests 19 passed | 1 skipped (20)
  ```

- Independent reviewer’s broader mobile set: 8 files / 28 tests passed.
- `npm run build`: pass.
- `node scripts/generate-mobile-opencode-operations.mjs`: generated 133
  decisions (89 allowed / 44 denied); deterministic diff pass.
- `git diff --check`: pass.

### Real-engine behavior

The vendored fork built successfully with:

```text
cd apps/opencode_fork/packages/opencode
bun run build --single
Smoke test passed: 0.0.0-codex/mobile-1169-proxy-202607250730
```

The final rebuilt API/fork ran only in the disposable sandbox on 4898/4897.
Health probes returned:

```text
GET :4898/health           -> {"status":"ok","service":"rhythm-api-server","commit":"dev"}
GET :4898/opencode/health  -> {"status":"ready","message":"Opencode SDK ready",...}
GET :4897/global/health    -> {"healthy":true,"version":"0.0.0-codex/mobile-1169-proxy-202607250730"}
```

Final live command:

```text
RHYTHM_LIVE_E2E=1 \
RHYTHM_LIVE_E2E_ISOLATED=1 \
RHYTHM_LIVE_URL=http://127.0.0.1:4898 \
RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:4897 \
RHYTHM_LIVE_DB_PATH=/tmp/rhythm-dev-sandbox-1169.X45fy5/rhythm.db \
RHYTHM_SANDBOX_DIR=/tmp/rhythm-dev-sandbox-1169.X45fy5 \
npx vitest run src/__tests__/issue_1169_mobile_opencode_proxy_live.test.ts

Test Files 1 passed (1)
Tests 1 passed (1)
```

That test paired a disposable device/user, selected a disposable registered
project, proxied global health, listed and created/deleted a real engine session,
read a unique file marker, and observed stable `403 OPERATION_NOT_ALLOWED` for
global upgrade. It deleted the session/database rows/project directory in
`finally`. The sandbox was removed and 4898/4897 were confirmed free.

### Full gates

- Exact serialized API:

  ```text
  npx vitest run --fileParallelism=false \
    --testTimeout=15000 --hookTimeout=15000

  Test Files 367 passed | 33 skipped (400)
  Tests 3207 passed | 52 skipped (3259)
  Duration 125.17s
  ```

- `VITEST_MAX_WORKERS=4 ai-workflow checks --level issue`: pass
  (Flutter analyze, Dart format, API `tsc --noEmit`).
- The PR wrapper had unrelated nondeterminism across three runs:
  - `phase8_collaboration.test.ts`: transient 404 vs 200; focused 3/3 pass.
  - `agent_schedules_delegation_guard.test.ts`: transient 401 vs 201; focused
    6/6 pass.
  - One-worker `dashboard_summary.test.ts`: one 5-second timeout after 366
    passing files; focused 9/9 pass in 1.49s.
  None imports or reaches the mobile proxy. The authoritative explicit
  serialized suite above passed all 3,207 active tests.

## Failure triage

- Fresh worktree fork build initially failed because ignored fork dependencies
  were absent (`@opentui/solid/preload` missing). `bun install --no-save`
  populated disposable dependencies, the exact fork build passed, and build-time
  `bun.lock` drift was reverted. Regenerable 5.7 GB fork dependencies were
  removed after the binary build.
- The first sandbox wrapper process was reaped by the command runner after the
  wrapper returned despite successful startup logs. Keeping the owning command
  session alive, then running the rebuilt API in the foreground, preserved the
  isolated process.
- Initial live smoke exposed two real implementation gaps and fixed both:
  Express initialized body-less GETs with `{}` (Node fetch rejects GET bodies),
  and OpenCode file APIs require paths relative to injected `directory`.
- Independent review then found three more concrete gaps before commit:
  pre-sanitization oversized roots could evade the request cap; the timeout was
  cleared after headers instead of body completion; malformed JSON failed before
  the router and leaked the original mobile query through the global logger.
  All three were repaired and regression-tested.
- One full-suite attempt reached 364 passing files before three suite-load
  `ENOSPC` errors. Only this worktree’s regenerable fork dependencies were
  removed; the exact rerun then passed 367/367 active files.

## GitNexus / security review

- Pre-edit proxy/router impact was conservatively reported HIGH while the new
  symbols were unindexed; parent authorization acknowledged the risk.
- Refreshed exact `MobileOpenCodeProxy` upstream impact: LOW, five impacted
  symbols, two direct, transitively `createApp`/server.
- `errorHandler` indexed impact: LOW/0, but treated semantically as global and
  guarded by mobile-only regression tests.
- Final staged detect: LOW, 17 files / 63 symbols / zero affected indexed
  processes.
- Independent scan confirmed all 39 forbidden-family operations denied, 133
  unique manifest IDs, and no sensitive production literals.
- Compare-to-main detect is expected to be HIGH because this cumulative base
  includes #1166–#1168 and fork/base divergence.

## Notes

- No production database, installed application, or production API/fork ports
  were touched.
- Temporary alternate-port sandbox helper changes, fork lock drift, GitNexus
  instruction-count edits, dependencies, and sandbox artifacts are excluded
  from the issue commit.
- No push, PR, or merge was performed from this worktree.
