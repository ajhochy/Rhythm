---
date: 2026-10-06
repo: rhythm
branch: codex/rhythm-mobile-canonical-backend-20261006
pr: none
issues: []
status: source-complete-unverified-on-device
tags: [run, rhythm]
---

# C3 canonical mobile notification — backend slice (source only)

Plan: `docs/ai/plans/2026-10-06-mobile-canonical-notification-reviewed.md`; review: `docs/ai/review/2026-10-06-mobile-canonical-notification-astra-review.md`. No commit. No live/device/server/model operation.

## Files (preimage → postimage sha256, preimage = working tree after the frozen core turn)

Changed files and exact full pre/post sha256: `2026-10-06-mobile-canonical-notification-backend.sha256` (repository, service, bridge, hub, proxy, security guard, messages repository, new `mobile_canonical_notification.test.ts`). Not touched: `routes/mobile_gateway_routes.ts` (current device/project proof exists: `requireMobileDevice`/`requireMobileProject`, re-proved at delivery), all mobile/fork/MCP/Dayflow/auth/async-delegation files. Bridge permission hunks (`decidePermission`, async-child provenance) are the frozen core postimage, untouched.

## Behavior

- Hub: `COORDINATOR_CHANGED_EVENT` + `publishCoordinatorChanged` (fresh `randomUUID` per call; identity-only).
- Repository: `findCanonicalNotificationScope` read-only lookup — owned, nonarchived, nonchild, nonsystem chat, `primaryOwnerRoot`, in nonarchived project with canonical directory; no SDK binding required.
- Service: hint after `addGoal`/`addGoalFromMessage`/foreground goal capture (`created`) and `recordStatusMessage` (`stored`) return. Replay/conflict/hold publish nothing. Failure is swallowed.
- Bridge: hint after successful `upsertPart` (incl. hosted-media), `applyPartDelta` (now returns whether it wrote), assistant/any-role `upsertMessageInfo`, and legacy `append` (before preview update). Raw engine frame of the reserved type is dropped in `_publishToHub`.
- Proxy/guard: type branches before generic acceptance; hub + project feed only; re-proves device, project root, exact payload shape, and lookup owner/project/conversation/session/directory synchronously before the write.

## Checks (run from repo root)

- `npm --prefix apps/api_server run build` → pass.
- `npm --prefix apps/api_server test -- src/__tests__/mobile_canonical_notification.test.ts --maxWorkers=1` → 12/12 pass (first runs failed on fixture setup only: FK on owner/project, unwired context assembler, mutation-before-hint ordering, row reset between cases; no product change was made to turn them green).
- `... issue_1379_mobile_event_fanout / issue_1379_bridge_hub_publish / issue_1170_mobile_realtime_proxy` → 27/27 pass.
- `... opencode_stream_bridge / coordinator_conversation_repository / coordinator_conversation_service` → 56/56 pass.
- `git diff --check` → clean.
- No pre-change red run of the new contract (new behavior; there was no producer to run against).

## Notes / known limits

- Existing named tests were not edited; the combined seam is one new focused file. Existing service/repository tests use a minimal DB without `projects`, so the lookup there returns null (silent no-op) by design.
- Per-token `applyPartDelta` hints share the 512-entry hub queue with native deltas for the primary root only; a very fast stream could trigger existing `STREAM_BACKPRESSURE` earlier. No coalescing added (no timer/queue allowed). Each hint costs one lookup (SQL + realpath).
- Not covered: bridge error system-row append, foreground reservation/settle, continuation/terminal state changes, async delegation completion (child enqueue/ACK intentionally not a root commit), relay/uplink preservation (fails closed: default lookup misses there).
- GitNexus: not consulted (no MCP tools exposed in this session; no reindex attempted). Direct callers reviewed manually: `MobileSseProxy.deliver` (hub + engine consumers), `_publishToHub` (global listener, heartbeat, tool-denied), `applyPartDelta` (bridge only; mocks returning `undefined` are falsy → no hint).
- No device/live acceptance claimed. Behavioral gate (`RHYTHM_LIVE_E2E`) not run: sandbox/server use not authorized this turn.
