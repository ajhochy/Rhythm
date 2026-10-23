# Rhythm — project state

## Current focus

Local browser acceptance passed: **93/93 included matrix cases**, with 25 AJ-approved exclusions, plus **4/4 dedicated real-account checks**. All three owned test records were deleted and read back; zero leftovers. [Final report](runs/2026-10-22-tailscale-web-final.md) · [Inventory and history](contracts/web-parity-20261022.json) · [Public evidence](../testing/results/2026-10-22-web-parity-final.json).

## Branch and running candidate

Feature worktree eager-star, branch `feat/tailscale-web-app-20261022`, local commits only. Code/build `89596fc186fa2662da66e0ba2f19413cbf6559c7`; final documentation is committed separately. Signed, unnotarized `apps/electron/dist/Rhythm.app` v0.18.83 is running: desktop58940, API58946 on loopback4001, engine58995 on4096. **http://localhost:4001/#/tasks** passed rendered Chromium, reload, real cloud and WebSocket101 checks. Mobile gateway4002 is disabled in this web session. No install, push, PR, merge, deployment or network changes.

Fallback `/private/tmp/rhythm-feature-playwright-2026-10-19/apps/electron/dist/Rhythm.app` at53a2c94b8e and its worktree remain intact. Existing SQLite backup metadata/integrity verified before launch. Exported real cloud credential contents were never inspected; metadata only. No existing profiles/providers/settings/schedules/MCP configuration was edited.

## Evidence and limits

Final895 synthetic partition: security8/8; standard95 passes/10 cloud-gated skips; fresh cloud10/10, no flakes. Exactly85 nonpaid included rows mapped to passing results. Saved policy91 and seven paid isolated cases pass, with exact per-run revision/working-source provenance retained. Scripted providers prove UI/transport only; Org Reviewer scan is not an improvement claim.

API aggregate9185 passed/7 failed/401 skipped; all seven reproduced at starting6081, including one inherited projection-boundary architectural defect. Electron591 passed/0 failed/5 skipped; known TS7053 remains. Gateway30 and focused18 passed. API/web builds and final deep-strict signing passed. This is not a universal repository-green claim; generic workflow wrapper, unrelated Flutter/mobile and strict MCP checks are not claimed passing. See final report for commands and source/package/runtime boundaries.

## Next step and authorization

Local acceptance is complete; proposed separate private HTTPS cutover awaits AJ's explicit yes under the original handoff rule. Replace existing raw TCP4001 with HTTPS4001 to127.0.0.1:4001 at `ajs-macbook-pro-3.tail3798ec.ts.net`, add the exact HTTPS origin and restart only the candidate; preserve existing443/8443, no Funnel/LaunchAgent. Actual peer/browser reachability remains unverified. Do not infer remote access from localhost health. Keep candidate running and preserve fallback/data.
