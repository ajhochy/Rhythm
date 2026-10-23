---
date: 2026-10-22
repo: Rhythm
branch: feat/tailscale-web-app-20261022
pr: null
issues: []
status: repaired-and-packaged-verified
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

## Final packaged and coexistence proof

Code commit `e8a8f094417f876843cc51cf61f751813ffcfe9d` fixes native precedence; observer-only follow-up/build revision **4bd758e09508655daedcc63cda8f9384f93ed848**. Fresh19 browser selection **19passed/0failed/0skip/0flaky**,37.275s, actualCLI0, originalsecurity8/8 and canonicaldown0. `/private/tmp/rhythm-web-desktop-fix-browser-confirm-20261022-report.json`.

- `bash /private/tmp/rhythm-web-desktop-final-build-sign.sh` — actualCLI0; exact-source full API/engine/Electron package, web TypeScript/Vite build, normalized four owned packaged spawn helpers, Developer ID sign-only. Deep/strict signature verification0; still unnotarized. Logs `/private/tmp/rhythm-web-desktop-4bd758e095-final-{build,web-build,sign}.log`. Unchanged shared10GiB guard; fallback53 preserved. Existing login job was booted out only during replacement of its owned app bundle; no second API started by hand.
- `python3 -I /private/tmp/rhythm-web-desktop-verify-launch.py` — actualCLI0; API build stamp and engine version exact4bd, five packaged API source/build hashes match (including changed guard), signature valid, browser asset hashes recorded. Existing LaunchAgent plist byte-for-byte unchanged; bootstrap0. Current desktop75471/API75478/engine75524.
- `python3 -I /private/tmp/rhythm-web-desktop-repair-20261022/ready.py` — actualCLI0; exact bundled executables own4001/4096, engine version4bd, owner/cloud ready, served browser assets match, mobile4002 absent.
- **Actual native UI**, using CUA against the running Rhythm window, before and after reload: `rhythm://app/index.html#/agents`, **Environment: Live · API :4001 healthy · Engine :4096 healthy**, profiles loaded, existing session loaded, New session enabled; previous session/project/model/account errors absent. Captured settled AX+screenshot together after reload completed, replacing the intermediate checking-state screenshot. Private screenshot `/private/tmp/rhythm-web-desktop-repaired-20261022.jpg`; no raw private UI tree committed. No message sent/model turn.
- `node /private/tmp/rhythm-web-desktop-repair-20261022/browser-proof.mjs` — actualCLI0; actual MagicDNS HTTPS Tasks render/reload, cloud/owner ready, secure WebSocket101, native bridge absent, zero mutations/page errors. Both clients are now working concurrently.
- Final launchctl state running with matching desktopPID. LaunchAgent configuration and Tailscale Serve are unchanged from accepted setup. No ACL/Funnel/LaunchAgent changes beyond unloading/reloading the same existing job for the owned bundle replacement.

[Durable public receipt](../../testing/results/2026-10-22-desktop-web-coexistence.json). Earlier93/93 matrix, real-account4, paid cases and large API/Electron gates remain historical evidence at their recorded revisions; they were not all rerun or relabeled at4bd. This change has53focused units,3real-engine collision checks,8original security checks,19rendered browser regressions, fresh exact signed package, and actual native+HTTPS proof. No universal repository-green claim; known baseline API/Electron typecheck failures remain recorded. No extra paid calls, real test creates, profile/provider/settings/schedule/MCP edits, push, PR or merge.
