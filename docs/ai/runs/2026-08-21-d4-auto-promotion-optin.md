---
date: 2026-08-21
repo: Rhythm
branch: agent-stack/si-d4-1442-optin-terra
pr: null
issues: [1442]
status: pass
tags: [run, rhythm, d4, optimizer]
index: "[[Rhythm]]"
---

# D4.4 auto-promotion availability and opt-in

Commit: local `feat(optimizer): add auto-promotion opt-in`.

## Files

- Added the server-owned availability read, authenticated optimizer settings
  route/service, atomic durable enable/disable repository operations, and
  env forwarding for the isolated sandbox.
- Added the shipping Flutter desktop Settings control, confirmation dialog,
  durable refresh/error handling, accessibility/keyboard tests, and visual
  goldens. The mobile prototype was not touched.
- Added the issue contract and API/live/UI coverage.

## Checks

- RED: the initial focused API contract had no config value or route (5
  failures); the initial Flutter contract had no mounted opt-in label.
- GREEN: Node 22 focused API contract plus adjacent trust-state coverage:
  18 tests passed; the env-gated live test skipped in normal mode.
- GREEN: `npm run build` in `apps/api_server` and Node 22 `tsc --noEmit`.
- GREEN: `flutter test test/features/settings/issue_1442_auto_promotion_contract_test.dart`
  (11 tests), then `flutter test test/features/settings` (73 tests).
- GREEN: `dart format . --set-exit-if-changed`, `flutter analyze --no-fatal-infos`
  (exit 0; 318 inherited infos), and `ai-workflow checks --level issue`.
- `ai-workflow checks --level pr` began after the issue gate but its full
  serial Flutter/API process was orphaned by the local execution harness;
  it is not claimed as evidence. The affected Settings suite, Node 22 API
  build, focused API suite, and live HTTP test above are the completed checks.
- GREEN live behavior: a freshly built fork and API were launched only with
  `tools/dev/sandbox.sh` on API 4398, engine 4397, and gateway 4399. With
  `RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1` and the sandbox DB path,
  `npx vitest run src/__tests__/live_e2e_1442_auto_promotion.test.ts --no-file-parallelism`
  passed 1/1. It observed authenticated GET state, confirmation refusal,
  server-authored enable timestamp, stale-regression refusal, and emergency
  disable through the real HTTP API. Sandbox teardown removed the directory
  and verified ports 4397/4398/4399 closed.
- Visual verification: committed Flutter goldens
  `issue_1442_auto_promotion_ready.png` and
  `issue_1442_auto_promotion_warning.png` render the Settings card and warning
  dialog; both were inspected and are nonblank.

## Notes

- Availability is a kill switch only; it never creates durable consent. A
  later #1441 implementation can import the central exported availability
  reader instead of parsing the environment again.
- The exact code-owned header/value is required for both enable and disable.
  Disable intentionally skips availability/eligibility/regression gates so an
  already-enabled user can immediately turn it off during an emergency.
- The first provided sandbox fixture had an incomplete OpenCode MCP entry and
  no active session, so it could not start the real engine. A throwaway,
  sanitized fixture containing only the migrated schema, a test user/session,
  and a disabled local MCP entry was used; no production data or ports were
  used.
- GitNexus impact and change detection are UNKNOWN: the worktree has no
  callable GitNexus integration/index. Direct caller inspection confines the
  change to the local optimizer API and desktop Settings layers.
