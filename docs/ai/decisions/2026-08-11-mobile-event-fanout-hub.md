---
date: 2026-08-11
tags: [decision, Rhythm]
---

# Mobile event streams fan out from the bridge, not from `ws_gateway.broadcast()`

## Context

Each paired phone opened its own SSE connection to the OpenCode engine's
`/global/event` (`MobileSseProxy` → `127.0.0.1:4096`). N phones meant N engine
streams, every one of them blocking on engine liveness just to *open*.

The api_server was already consuming that exact stream — once — in
`OpencodeStreamBridge.ensureGlobalStream` (OCU-29 / #1070), persisting every
frame into `agent_session_messages` / `agent_sessions` before relaying it. The
obvious-sounding fix, "make `broadcast()` reach mobile", was assessed and
rejected.

## Decision

Add an in-process fan-out hub (`opencode_event_hub.ts`) that the bridge
publishes each `/global/event` envelope to, and have `MobileSseProxy` subscribe
to it instead of dialing the engine. `ws_gateway.broadcast()` is left exactly as
it is.

The reason is the DTO, not the transport. `broadcast()` emits Rhythm's
**desktop** shape (`{v:1, type:'session.status', id, working}`), synthesized by
`_relayEvent` from the engine event. Mobile parses the **engine's own** shape,
and that is load-bearing: mirror-served mobile reads need no re-pair precisely
because they stay behind already-fingerprinted engine contracts
(`gatewayVersion` / `opencodeVersion` / `contractFingerprint` are exact-equality
gated — any drift flips every paired phone to `incompatible`). Reshaping the
desktop DTO for the phone would introduce a Rhythm-native stream DTO with no
drift protection, to reuse a function name.

So the fan-out point is one layer upstream of `broadcast()`, where the frame is
still the engine's `{directory, payload}` envelope — the same bytes
`MobileSseProxy` used to read off the socket.

Supporting calls:

- **Publish after `_relayEvent`** (except heartbeats, which have no relay), so
  a frame reaching a phone has already been written to the mirror.
- **Fail soft:** when the hub cannot serve (`RHYTHM_SSE_GLOBAL=0`, an engine
  without `/global/event`, or a subscribe failure) the proxy takes the unchanged
  per-device engine path. A phone on a hub with no producer is a silently dead
  stream — worse than the status quo.
- **Liveness survives a watchdog resubscribe but not `stopAll`,** so a phone
  rides out an engine restart on a quiet stream instead of falling back to
  hammering a dead engine.
- **`isLive()` is a synchronous flag, and the connect path never starts the
  stream.** `server.ts` starts it on engine-ready and `streamSession` starts it
  too. Making a device connect await a start would put a real engine round-trip
  on every phone connect precisely when the engine is unavailable.
- **Bounded per-subscriber queue.** Overflow drops that one subscriber via the
  existing `STREAM_BACKPRESSURE` / `gateway.error` frame — no new error code, no
  client change, no unbounded heap growth from one slow phone.

## Alternatives

- **Widen `broadcast()` to mobile clients.** Rejected: wrong DTO (see above),
  and it would also have to re-apply per-owner/per-project/per-session filtering
  that `broadcast()` has no concept of.
- **A second engine subscription owned by the gateway.** Halves nothing — still
  one extra engine stream, and it would need its own watchdog/resubscribe logic
  duplicating the bridge's.
- **Keep per-device streams and just add retry.** That is Phase 0 (#1378),
  already shipped. It makes a cold engine survivable; it does not make the
  stream engine-independent.
- **Reconnect replay by `sdk_message_id`.** Rejected as redundant: the phone's
  subscribe loop already awaits a full `refreshSessions` /
  `refreshCurrentSession` / `refreshPendingInteractions` pass on every
  (re)connect, which catches up from the mirror — a stronger guarantee than a
  bounded replay window, and it needs no new cursor state or `Last-Event-ID`
  support on the client.

## Consequences

- N phones cost **zero** extra engine connections; opening a mobile event
  stream no longer blocks on engine liveness at all.
- `MobileSseProxy` now has two transports. They share one `deliver()` — the
  single place that applies ownership scoping, session narrowing, dedupe, and
  host-path scrubbing — so they cannot drift apart on security. Any future
  filter change must go there, not into one branch.
- The bridge is now on the critical path for mobile streaming, not just for
  desktop and persistence. `publish()` is therefore written to never throw:
  a misbehaving subscriber cannot stall the ingest loop.
- Phase 2's remaining plan bullet, optimistic outgoing-bubble rendering, is a
  mobile chat-UI change with no dependency on this work and is deliberately left
  to its own issue.
