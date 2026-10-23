---
date: 2026-10-22
repo: Rhythm
branch: feat/tailscale-web-app-20261022
pr: null
issues: []
status: unverified-packaged-runtime
tags: [run, rhythm, regression, desktop, web]
---

# Desktop and browser coexistence

## Files

- `apps/api_server/src/middleware/local_agent_surface_guard.ts`: preserve the already-trusted native origin on valid loopback Hosts before the browser-specific origin branch.
- `web_host_surface_contract.test.ts`: regression for overlapping loopback web Hosts, HTTP preflight, native rejection on nonloopback Hosts, foreign/null origins.
- `apps/web/tests/web-host/desktop-coexistence-live.test.mjs`: gated real sandbox API/engine and actual HTTP/WS regression with both loopback browser origins configured.
- [Contract](../contracts/desktop-web-coexistence-20261022.json).

## Checks

Read registry and previous browser/login receipts first. Actual signed895 candidate native AX shows API4001 error/engine4096 error, session/project/model catalogs unavailable. Real HTTP `/opencode/runtime` on localhost4001 and127.0.0.1:4001 returns403 FORBIDDEN_ORIGIN for native `rhythm://app`, but200 for configured browser origin. The API/engine are healthy; the native request is blocked before routes/CORS.

Root cause: `isAllowedLocalAgentSurfaceRequest` first enters the browser branch when Host is in RHYTHM_WEB_PUBLIC_ORIGIN. The local browser origins collide with desktop loopback Hosts; browser origins deliberately permit onlyHTTP(S), so the desktop origin is incorrectly rejected. Earlier F1/F2 checks configured only the remote synthetic web Host and missed this overlap. LaunchAgent starts the same web-mode candidate; this is not a separate backend or engine-outage failure.

GitNexus upstream impact LOW, three direct callers (middleware, Dayflow router, WS gateway), four total impacted symbols, no indexed execution flows; index stale28commits. Manual review confirms shared HTTP/WS guard sensitivity. No guard disable, wildcard browser origin, remote native-origin allow, auth bypass or network/ACL change.

- Unit RED: `npm run build:guard -- npm --prefix apps/api_server test -- src/middleware/web_host_surface_contract.test.ts`, actual CLI1, **3failed/11passed**. Log `/private/tmp/rhythm-web-desktop-collision-red-20261022.log`. Initial broad mock attempt also changed an existing negative test's configured input; restored original mock and scoped collision inputs to their own cases before final RED. Original assertions retained.
- Focused GREEN: `npm run build:guard -- npm --prefix apps/api_server test -- src/middleware/web_host_surface_contract.test.ts src/middleware/local_agent_surface_guard.test.ts src/contract/local_agent_surface_hardening.test.ts src/config/web_host.test.ts src/services/web_host_csp.test.ts`, CLI0, **53/53**,5files,3.23s. Log `/private/tmp/rhythm-web-desktop-collision-green-20261022.log`.
- Real-engine mutation RED: `python3 -I /private/tmp/rhythm-web-desktop-coexist-driver.py red`, child CLI1, **1passed/2failed** (native HTTP preflight/readiness and WS upgrades fail), denial controls pass, canonicaldown/portaudit0. Only guard restored to oldHEAD for this run; corrected source restored in finally and SHA verified. `/private/tmp/rhythm-web-desktop-coexist-contract-red-20261022.log`.
- Live GREEN: same driver `green`, **3/3**, actual CLI0, canonicaldown/portaudit0. Tests gated by RHYTHM_LIVE_E2E1, real API/engine through canonical sandbox, both loopback origins plus synthetic weborigin. Existing default security suite will run separately with its original single-origin assumptions; no assertions relaxed to fit the new fixture.

## Notes

Change uses the existing trusted native origin list and local-address host check ahead of browser handling, preserving existing native metadata semantics. Existing browser path/CSRF checks unchanged. New live controls require remote Host+native Origin and foreign/null/cross-site browser requests to remain403. No real data writes or new model calls.

Packaged repair remains UNVERIFIED until rebuilt/signed and native UI plus HTTPS coexistence proof. Preserve fallback53a2c94b8e and existing real data; use unchanged10GiB guard. LaunchAgent must be unloaded during replacement of its owned candidate, then reloaded with existing configuration; do not change Tailscale or add a second api_server. This run does not claim generic repo-wide/API aggregate green; previous baseline failures remain out of scope.

### Browser regression observer correction

Original security8/8 passed. Additional Playwright selection initially18passed/1failed (19tests,37.803s), zero retries/skips/flakes, canonicaldown0. Only #45 failed with Chromium `Network.getResponseBody: No resource with given identifier found`, explicitly reporting a response invalidated by navigation. Source registered its response waiter after initial goto while the first page catalog could still finish, then reloaded before reading that body. Following the already recorded #41 recon pattern, wait for initial profile-label visibility (catalog/editor loaded) before registering the reload observer. Added only this synchronization; retained every catalog/UI equality assertion. This is an observer/codify race, not an app behavior fix. Fresh full19 selection running; first failure retained in `/private/tmp/rhythm-web-desktop-fix-browser-20261022-report.json`.
