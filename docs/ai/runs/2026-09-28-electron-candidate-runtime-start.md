---
date: 2026-09-28
repo: Rhythm
branch: mega/2026-09-18-mobile-electron-hermes
pr: 1544
issues: []
status: pass
tags: [run, rhythm]
---

# Electron candidate never connected to Agent API / engine

## Files
- `apps/electron/scripts/sign-and-notarize-mac.mjs` — `RHYTHM_SIGN_ONLY=1` (Developer ID, no notarization; Hermes manifest key optional).
- `apps/api_server/src/services/relay_uplink_client.ts` — batched, yielding, backpressured outbox drain.

## Checks
- electron: manifest-signing, e12b native signing (`--experimental-vm-modules`), signing-identity guard — 22/22.
- api_server: `tsc --noEmit` clean; relay contract suites 61/61.
- Live: sign-only candidate, API :4001 200 and engine :4096 200 in 9s, `/opencode/health` ready + bridgeLive, stable past the 45s readiness window.

## Notes
- Ad-hoc `package:mac` output can never start the runtime: `authorizeParent()` in the approval helper requires a team-signed parent. The dialog blames Keychain; it is the signature.
- Local candidate recipe: `npm run package:mac` then `RHYTHM_SIGN_ONLY=1 APPLE_SIGNING_IDENTITY=CF6C1EF1525E70E6E3324388A322938977779DB7 APPLE_TEAM_ID=56Q69NYP9H npm run sign:mac`.
- Engine "Timeout waiting for server to start after 5000ms" with a timer firing ~12s late = blocked event loop, not a slow engine. Cause was a 1.7 GB `relay_outbox` (9,790 rows, 8,155 message upserts of up to 19 MB each) drained synchronously.
- Outbox is not being acked/pruned (count unchanged after drain) and grows ~0.8 GB/hour; Electron DB is 6 GB. Follow-up.
- In-app Retry after `healthCheckTimeout` did not respawn the API server. Follow-up.
