---
date: 2026-07-24
repo: Rhythm
branch: codex/mobile-1166-pairing-security
pr: null
issues: [1166]
status: live-pending
tags: [run, Rhythm]
---

# Issue #1166 pairing security

## Files

- Added the issue acceptance contract and real HTTP/SQLite contract tests.
- Added Cloud bearer identity validation with a local-session fast path and
  authoritative `/auth/me` fallback.
- Added distinct mobile `Device` authentication and a bearer-or-device health
  boundary; missing, invalid, replaced, and revoked credentials fail closed.
- Changed create/list/revoke identity to the authenticated server context.
  Pairing rejects a conflicting claimed identity and removes the one-time code
  from the request body before service/error handling.
- Replaced the unauthenticated route/live test assumptions and added
  constant-time comparison coverage.

## Checks

- RED:
  `cd apps/api_server && node_modules/.bin/vitest run src/__tests__/issue_1166_pairing_contract.test.ts`
  — failed on the baseline with unauthenticated statuses
  `[201, 401, 200, 404, 200]` instead of five `401`s; bearer requests without
  body `userId` also failed.
- Focused:
  `node_modules/.bin/vitest run src/__tests__/issue_1166_pairing_contract.test.ts src/__tests__/mobile_gateway_routes.test.ts src/services/__tests__/mobile_pairing_service.test.ts src/services/__tests__/mobile_cloud_identity_service.test.ts`
  — PASS, 4 files / 16 tests.
- Build: `npm run build` — PASS.
- Full API: `npm test` — PASS, 364 files / 3196 tests; 31 files / 50 tests
  skipped by their existing env gates.
- Repository issue gate:
  `VITEST_MAX_WORKERS=4 ai-workflow checks --level issue` — PASS (Flutter
  analyze, Dart format, API `tsc --noEmit`).
- Repository PR gate:
  `VITEST_MAX_WORKERS=4 ai-workflow checks --level pr` — PASS (issue checks
  plus the full API Vitest suite). Four workers were used because the default
  pool saturated this shared multi-worktree run and timed out unrelated hooks;
  the isolated timed-out files passed 28/28 before the bounded rerun.
- Live contract compile/gate:
  `node_modules/.bin/vitest run src/__tests__/issue_1166_pairing_live.test.ts`
  — PASS with the single test skipped because `RHYTHM_LIVE_E2E` was not set.
- Read-only listener audit: installed app processes remained on 4001/4096;
  `/Users/ajhochhalter/Documents/rhythm-worktrees/creative-platform` remained
  on 4098/4097. No server or sandbox process was started, stopped, or signaled.

## Notes

- GitNexus upstream impact: `MobileGatewayController` LOW (6),
  `createMobileGatewayRouter` LOW (1), `MobilePairingService` LOW (7).
  `MobileDevicesRepository` was HIGH (18), so it was deliberately not edited.
- The live behavior test is ready for an isolated sandbox on API 4098 / engine
  4097 with `RHYTHM_LIVE_E2E=1`, `RHYTHM_LIVE_E2E_ISOLATED=1`, and
  `RHYTHM_LIVE_DB_PATH` pointing at the sandbox copy. It refuses 4001 and the
  installed app database.
- Acceptance criterion c4 remains pending until those ports are released and
  the checked-in live test runs against this build. Criterion c6 remains
  pending for a separate read-only reviewer; this implementation does not
  self-certify.
