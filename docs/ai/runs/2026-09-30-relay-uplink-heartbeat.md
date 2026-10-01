---
date: 2026-09-30
repo: Rhythm
branch: fix/relay-uplink-heartbeat
pr: TBD
issues: []
status: awaiting-manual-smoke
tags: [run, rhythm, relay]
index: "[[Rhythm]]"
---

# Relay uplink heartbeat + loud failures

## Files

- `apps/api_server/src/services/relay_uplink_client.ts` — WS ping/pong, idle
  timeout that terminates and redials, `dialLoop()` guarded against a throw
  killing the loop.
- `apps/api_server/src/services/relay_uplink_server.ts` — ping/pong on the
  uplink, `lastUplinkAt` stamped on **every** inbound frame, `isMacOnline()`
  derived from that freshness, `offlineReason()`, and an RPC timeout.
- `apps/api_server/src/routes/relay_gateway_routes.ts` — all 8 offline answers
  now carry `message` + `lastUplinkAt` via `offlineBody()`.
- `apps/api_server/src/services/opencode_health.ts` — throttled background
  re-initialization of a failed engine client; `recovering` in the payload.
- `apps/api_server/src/services/mobile_gateway_access_log.ts` (new) — one log
  line per `/mobile-gateway` and `/relay` request, route-shaped, no secrets.
- `apps/api_server/src/app.ts` — mounts the access log on both surfaces.
- Tests: `relay_uplink_heartbeat.test.ts`, `opencode_health_recovery.test.ts`,
  `mobile_gateway_access_log.test.ts`, `apps/mobile/tests/relay-offline-explanation.test.ts`.

## Checks

- `tsc --noEmit` clean in `apps/api_server` and `apps/mobile`.
- All new tests mutation-verified: each was re-run against a deliberately
  reverted implementation and failed.
- Full `vitest run` (api_server) and the mobile jest suites — see PR.

## Notes

- The 2026-09-30 diagnosis burned a day on five falsified assumptions, all the
  same mistake: trusting a field name as a measurement. `lastUplinkAt` was
  stamped in three places only (hello, `ctrl/health`, `ctrl/resync-done`), so a
  frozen value was the NORMAL look of a busy, healthy tunnel. `macOnline`
  reported socket presence. Both now mean what they say.
- The direct cause of the phone's "A network error occurred" was
  `RelayUplinkServer.sendRpc` having **no timeout**: on a half-open socket the
  promise never settled, Express held the phone's connection, and the phone
  rendered its own fetch failure. It now rejects with `MacOfflineError` after
  20s and marks the Mac offline.
- Issue #1586 (sessions stuck `status=working`) is NOT covered. It is a
  session/provider-stream concern, not WS transport. It shares the diagnosis
  shape though: `last_activity_at` is the same name-is-not-a-measurement trap.
- `/mobile-gateway` had appeared zero times in every log file back to Sep 7,
  which is why the root cause could not be reconstructed from logs.
