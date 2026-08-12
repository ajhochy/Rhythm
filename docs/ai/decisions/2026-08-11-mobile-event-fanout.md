---
date: 2026-08-11
tags: [decision, Rhythm]
---

# Mobile live events fan out from the engine stream, not from `ws_gateway.broadcast()`

## Context

Phase 2 of `docs/ai/plan-mobile-smart-client.md` (#1379b) removes the per-device
engine SSE stream. The plan and the Phase 1 run log both name
`ws_gateway.broadcast()` as the blocker: it "only fans to the loopback
`/ws/agents` clients Set — mobile receives none of the bridge's already-synced
frames today."

That framing invites the fix "make `broadcast()` reach non-loopback clients."

## Decision

**Do not widen `broadcast()`.** Add the fan-out one layer lower, at
`OpencodeClientService.subscribeToGlobalEvents`, where the engine's raw
`/global/event` envelopes still exist. `broadcast()` is left unchanged.

## Alternatives

1. **Widen `broadcast()` to reach phones.** Rejected on two independent grounds:
   - *Wrong payload.* `broadcast()` emits Rhythm-native desktop DTOs
     (`{v:1, type:'session.status', …}`). Mobile consumes the engine's own event
     shape, which is what keeps it inside the `contractFingerprint`-pinned
     surface. Reshaping desktop frames for mobile moves the phone off the pinned
     contract and forces a re-pair of every paired device.
   - *Wrong security posture.* `/ws/agents` is an `AGENT_LOCAL`-bypassed surface
     with no per-user ownership filter, deliberately gated by
     `isAllowedLocalAgentSurfaceRequest` plus an actual-loopback socket check.
     Widening it to Tailscale clients punches through the gateway auth boundary.

2. **Publish from `OpencodeStreamBridge._listenGlobal`.** Rejected: the bridge
   swallows `server.heartbeat`/`server.connected` (the phone's keepalive and its
   only traffic on an idle stream), and it sees the event already unwrapped, so
   the `directory`-wrapped envelope the fail-closed mobile filter requires would
   have to be reconstructed.

3. **Reconnect replay by synthesizing engine frames from mirrored rows.**
   Deferred: the mirror stores messages, not engine event ids, so this means a
   second renderer of data the phone already re-reads from the mirror on open
   (Phase 1). Should be its own issue against the message cursor if device
   evidence shows a real gap.

## Consequences

- N paired phones now cost **zero** additional engine streams.
- Entirely server-side: no fingerprint change, no re-pair, no app update.
- A phone's downstream connection survives an engine restart — the bus goes
  quiet and the loop waits — instead of dropping and re-running a 30s scope
  pre-check.
- The direct engine stream stays as fallback (`RHYTHM_SSE_GLOBAL=0`, engines
  without `/global/event`, api_server before its first session), so existing
  behavior is preserved wherever no producer is attached.
- Mobile-facing frames are published just before the bridge persists them, not
  after. Accepted: the window is microtasks and the phone re-reads the mirror on
  open. Tapping after persistence would cost the heartbeat keepalive.
- Backpressure is isolated per subscriber. The producer also drives SQLite
  persistence for every session, so a slow phone is failed rather than allowed
  to stall it.
