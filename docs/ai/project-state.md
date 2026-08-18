# Rhythm — Project State

**Focus:** Mobile smart-client rebuild — **complete, PR open, awaiting manual smoke + merge.**
**Branch:** `mobile/smart-client-rebuild` → **PR #1383** (https://github.com/ajhochy/Rhythm/pull/1383). **Do NOT merge** — AJ merges after manual testing.

## What shipped
MEGA PR #1368 **merged** (all 59 issues; new surfaces off by default:
`RHYTHM_RESEARCH_PROJECTS_ENABLED=off`, `RHYTHM_MCP_APPS_MODE=off`).

#1368 lifted the **React Native** halves of the mobile workstream off its branch
(`f4c7c352`) while the server halves landed. PR #1383 restores that RN transport:
#1270 profile fallback · #1308/#1311 attachment-limit constant · #1364/#1366
session-lifecycle fencing · #1247 SSE permission replay. Five commits, one per issue.

#1363 (binding-repair CLI) was never reverted — server-side, already on main, verified intact.

## Test status (PR #1383)
- mobile: tsc clean, eslint 0 errors, **Jest 61/61**, **Playwright 71/71**, `test:ci:static` exit 0,
  contract green (**136 ops**) — matches mega-HEAD parity exactly.
- api_server: mobile gateway + proxy 17/17; `session_binding_cleanup` 3/3.
- **Contract anchors untouched → no fingerprint bump, no re-pair.**

## Two regressions found during the rebuild
1. `eas.json` lost `ascAppId` (revert reset it pre-#1175) — non-interactive TestFlight submit would
   prompt and fail. Restored + the iOS preflight now requires a non-empty `ascAppId` (it previously
   accepted an empty `ios: {}`).
2. `issue-1247.test.mjs` was orphaned (no npm script ever ran it). Wired into `test:ci:static`.

## NOT started — #1378 / #1379 smart-client plan
`docs/ai/plan-mobile-smart-client.md` is a **proposed** plan to make the phone a client of the
api_server mirror instead of a raw-engine proxy (Phases 0–4). It is unrelated to PR #1383's six
issues and is **unimplemented**. Its four open decisions still need a call before Phase 1/2 —
chiefly mirror authority vs. live backfill, and whether new mobile-native DTOs get a contract
version separate from the engine fingerprint.

## Flaky note (pre-existing, out of scope)
api_server vitest + mobile Playwright each surface ~1 parallel-execution flake per full run (shared
DB/port), always a *different* test, all passing in isolation. CI re-run clears transient reds.
(Both full mobile suites ran clean on #1383.)

## Next step
AJ: manual-smoke PR #1383 on-device. The specific check is #1364's ready state — create a new chat
and confirm it reaches "Start a new task" rather than flashing missing-session. Then merge.
```bash
cd apps/mobile && npm run test:ci:static   # full automated gate, exit 0
```
