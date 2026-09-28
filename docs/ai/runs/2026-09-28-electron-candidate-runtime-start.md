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

## Follow-up: relay outbox (#1583)
- Root cause of the buildup: per-update full-row snapshots (97% superseded), plus a self-reinforcing loop. Once draining blocked startup >45s, every launch was killed before the relay acked, so nothing was pruned.
- Fix: one pending entry per record, live row read at send, boot-time compaction, backpressured 10-row drain.
- Live: 7,622 rows / 1,201 MB → 737 pointer rows on boot; drained to 124 in 90s (relay acks every 100).
- Checks: relay suites 63/63; full api_server 6,681 pass, 1 pre-existing failure (native_runtime_guard, better-sqlite3 13 guard vs borrowed main node_modules; fails without this change too).
- The DB file stays 6 GB until a VACUUM; freed pages are reused.

## Follow-up: attachments out of chat rows
- Cause of multi-MB rows: read-tool images (full-res JPEGs) and uploads stored as base64 data: URLs in parts_json; the largest message was 136 MB (8 photos).
- Fix: upsertPart hosts PNG/JPEG/WebP/GIF/PDF attachments (>8 KB) in the media store (pinned; project-less sessions use `session:<id>`); background backfill; relay strips data: URLs >64 KB and caps rows at 16 MB; engine image normalize re-enabled with keep-original fallback; mobile and Electron composers downscale to 2048 px before upload; Flutter renders `/artifacts/<id>`; `/artifacts` accepts tokenless AGENT_LOCAL loopback.
- Live (Electron DB): backfill rewrote 874 messages, 1,652 artifacts / 1,053 MB (store 912 MB after dedupe); msg 69309 136 MB → 10.9 KB; sha256 identical before / on disk / served; 24 MB of non-attachment base64 (tool text, SVG) left inline; API + engine healthy throughout.
- Not verified live: engine resize (fork build command denied; needs a rebuild), mobile compression (needs a new mobile build for expo-image-manipulator).
- DB file still 5.6 GB until VACUUM (app closed).
- Pre-existing failures: api native_runtime_guard; mobile issue-1387 offline contract ×4 (fail without these changes).
