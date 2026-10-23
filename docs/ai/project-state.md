# Rhythm — project state

## Current focus

**External access repaired and confirmed:** AJ confirmed Rhythm loads on Mac’s Mac mini. Personal-tailnet policy now permits all tailnet sources to this Mac TCP4001 over IPv4/IPv6. Six prior deny tests now require allow; other rules preserved. [Repair receipt](runs/2026-10-22-tailscale-web-external-access.md).

Local browser acceptance passed: **93/93 included matrix cases**, with 25 AJ-approved exclusions, plus **4/4 dedicated real-account checks**. All three owned test records were deleted and read back; zero leftovers. [Final report](runs/2026-10-22-tailscale-web-final.md) · [Inventory and history](contracts/web-parity-20261022.json) · [Public evidence](../testing/results/2026-10-22-web-parity-final.json).

## Branch and running candidate

Feature worktree eager-star, branch `feat/tailscale-web-app-20261022`, local commits only. Code/build `89596fc186fa2662da66e0ba2f19413cbf6559c7`; final documentation is committed separately. Signed, unnotarized `apps/electron/dist/Rhythm.app` v0.18.83 is running: desktop64828, API64835 on loopback4001, engine64887 on4096. **http://localhost:4001/#/tasks** passed rendered Chromium, reload, real cloud and WebSocket101 checks. Mobile gateway4002 is disabled in this web session. No install, push, PR or merge. The separately approved private HTTPS cutover is complete; no Funnel or LaunchAgent changes.

Fallback `/private/tmp/rhythm-feature-playwright-2026-10-19/apps/electron/dist/Rhythm.app` at53a2c94b8e and its worktree remain intact. Existing SQLite backup metadata/integrity verified before launch. Exported real cloud credential contents were never inspected; metadata only. No existing profiles/providers/settings/schedules/MCP configuration was edited.

## Evidence and limits

Final895 synthetic partition: security8/8; standard95 passes/10 cloud-gated skips; fresh cloud10/10, no flakes. Exactly85 nonpaid included rows mapped to passing results. Saved policy91 and seven paid isolated cases pass, with exact per-run revision/working-source provenance retained. Scripted providers prove UI/transport only; Org Reviewer scan is not an improvement claim.

API aggregate9185 passed/7 failed/401 skipped; all seven reproduced at starting6081, including one inherited projection-boundary architectural defect. Electron591 passed/0 failed/5 skipped; known TS7053 remains. Gateway30 and focused18 passed. API/web builds and final deep-strict signing passed. This is not a universal repository-green claim; generic workflow wrapper, unrelated Flutter/mobile and strict MCP checks are not claimed passing. See final report for commands and source/package/runtime boundaries.

## Private HTTPS and next step

AJ explicitly approved the separate cutover. **https://ajs-macbook-pro-3.tail3798ec.ts.net:4001/#/tasks** is active within the tailnet: raw TCP4001 retired, HTTPS4001 proxies to loopback4001, exact browser origin added, candidate restarted. Existing443/8443 mappings are byte-equivalent. Valid TLS/HTTP200, actual Chromium Tasks render/reload, cloud access and WebSocket101 passed through the MagicDNS URL; zero writes/page errors. [Cutover receipt](../testing/results/2026-10-22-web-https-cutover.json). AJ subsequently confirmed the page loads on Mac’s Mac mini after the central policy repair. Mobile4002 stays disabled. No persistence/LaunchAgent was configured. Keep candidate running and preserve fallback/data.
