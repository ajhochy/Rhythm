# Rhythm — project state

## Current focus

**Desktop/browser coexistence repaired:** trusted native origin was rejected when its loopback Host also appeared in the browser allowlist. Narrow guard precedence fix, unit/live RED→GREEN, signed4bd candidate now shows native API/engine healthy and existing session loaded; concurrent HTTPS browser render/reload/cloud/WSS passed. [Repair receipt](runs/2026-10-22-desktop-web-coexistence.md).

**External access repaired and confirmed:** AJ confirmed Rhythm loads on Mac’s Mac mini. Personal-tailnet policy now permits all tailnet sources to this Mac TCP4001 over IPv4/IPv6. Six prior deny tests now require allow; other rules preserved. [Repair receipt](runs/2026-10-22-tailscale-web-external-access.md).

Local browser acceptance passed: **93/93 included matrix cases**, with 25 AJ-approved exclusions, plus **4/4 dedicated real-account checks**. All three owned test records were deleted and read back; zero leftovers. [Final report](runs/2026-10-22-tailscale-web-final.md) · [Inventory and history](contracts/web-parity-20261022.json) · [Public evidence](../testing/results/2026-10-22-web-parity-final.json).

## Branch and running candidate

Feature worktree eager-star, branch `feat/tailscale-web-app-20261022`, pushed through [PR1621](https://github.com/ajhochy/Rhythm/pull/1621) against `mega/2026-09-29-consolidation`; AJ explicitly authorized merging into mega. PR metadata records the merge state and SHA. CI-only Node loader and Linux fixture-path repairs are recorded in the [integration run](runs/2026-10-23-tailscale-web-pr-merge.md). Current code/build `4bd758e09508655daedcc63cda8f9384f93ed848` (original93-row acceptance used89596fc186fa2662da66e0ba2f19413cbf6559c7); final documentation is committed separately. Signed, unnotarized `apps/electron/dist/Rhythm.app` v0.18.83 is running: desktop75471, API75478 on loopback4001, engine75524 on4096. **http://localhost:4001/#/tasks** passed rendered Chromium, reload, real cloud and WebSocket101 checks. Mobile gateway4002 is disabled in this web session. No installation or production deployment. Keep this checkout and branch while the login service depends on its bundle/assets. The separately approved private HTTPS cutover is complete; no Funnel changes. AJ subsequently authorized the login LaunchAgent, now installed and verified.

Fallback `/private/tmp/rhythm-feature-playwright-2026-10-19/apps/electron/dist/Rhythm.app` at53a2c94b8e and its worktree remain intact. Existing SQLite backup metadata/integrity verified before launch. Exported real cloud credential contents were never inspected; metadata only. No existing profiles/providers/settings/schedules/MCP configuration was edited.

## Evidence and limits

Final895 synthetic partition: security8/8; standard95 passes/10 cloud-gated skips; fresh cloud10/10, no flakes. Exactly85 nonpaid included rows mapped to passing results. Saved policy91 and seven paid isolated cases pass, with exact per-run revision/working-source provenance retained. Scripted providers prove UI/transport only; Org Reviewer scan is not an improvement claim.

API aggregate9185 passed/7 failed/401 skipped; all seven reproduced at starting6081, including one inherited projection-boundary architectural defect. Electron591 passed/0 failed/5 skipped; known TS7053 remains. Gateway30 and focused18 passed. API/web builds and final deep-strict signing passed. This is not a universal repository-green claim; generic workflow wrapper, unrelated Flutter/mobile and strict MCP checks are not claimed passing. See final report for commands and source/package/runtime boundaries.

## Private HTTPS and next step

AJ explicitly approved the separate cutover. **https://ajs-macbook-pro-3.tail3798ec.ts.net:4001/#/tasks** is active within the tailnet: raw TCP4001 retired, HTTPS4001 proxies to loopback4001, exact browser origin added, candidate restarted. Existing443/8443 mappings are byte-equivalent. Valid TLS/HTTP200, actual Chromium Tasks render/reload, cloud access and WebSocket101 passed through the MagicDNS URL; zero writes/page errors. [Cutover receipt](../testing/results/2026-10-22-web-https-cutover.json). AJ subsequently confirmed the page loads on Mac’s Mac mini after the central policy repair. Mobile4002 stays disabled. Login startup and KeepAlive are now configured through `com.ajhochhalter.rhythm-web-host`; actual launchd start/recovery and HTTPS browser/WSS passed. [Setup and stop/disable commands](runs/2026-10-22-tailscale-web-login-agent.md). Keep candidate running and preserve fallback/data.

## Integration checks

Web Unit CI passes after resolving real gateway dependencies in test loaders (98/98 locally and CI). Web TypeScript/Vite build passes. Five additional Node contract failures reproduce exactly on mega (current71/76). Linux API CI baseline is52 failing tests plus one failed suite at exact mega base; two new setup-only failures from literal `/private/tmp` were repaired with Node os.tmpdir(), local2/2. Final b52 CI: web/mobile/fork/Postgres green; full server9082pass/52fail/418skip, exact same failure-name set as mega with zero new failures. See the integration run and public CI comparison. The earlier macOS API aggregate7 failures and Linux52 are separate evidence. No universal repository-green claim.
