---
date: 2026-09-30
repo: Rhythm
tags: [decision, rhythm, relay]
index: "[[Rhythm]]"
---

# Uplink liveness is derived from evidence, never asserted

## Context

A relay uplink outage on 2026-09-30 was invisible to every health surface the
system exposes. `macOnline` was true, `lastUplinkAt` looked plausible, the Mac's
`isConnected()` was true, and the phone showed a generic network error. Five
diagnostic assumptions were falsified in a day, each one a case of reading a
field name as if it were a measurement.

## Decision

Any field that claims liveness must be derived from observed traffic:

1. `lastUplinkAt` is stamped on **every** inbound frame and on every WS pong —
   not on a hand-picked set of control frames.
2. `isMacOnline()` returns `macOnline && freshness(lastUplinkAt)`. Socket
   presence alone is never sufficient.
3. Both ends run WS ping/pong with an idle timeout that terminates the socket,
   so a half-open tunnel becomes a close event and therefore a redial.
4. Every request that crosses the tunnel has a timeout. A request that cannot be
   answered fails loudly; it never hangs.
5. Every offline answer carries a human-readable `message` and `lastUplinkAt`,
   because "mac_offline" with no timestamp is not actionable for a user.

## Alternatives

- **Rename `lastUplinkAt` to `lastControlFrameAt`.** Honest, cheaper, and
  rejected: the relay genuinely needs a liveness signal, so the field would have
  had to be added anyway.
- **Application-level heartbeat frames.** Rejected: `ws` already has ping/pong
  at the protocol level, and a new frame type would need both ends upgraded in
  lockstep.

## Consequences

- A dead uplink is now detected within ~60s on either end and self-heals via the
  existing redial path.
- `macOnline` can report false while a socket object is still open. Callers that
  assumed socket presence must go through `isMacOnline()`; `isHostOnline()` and
  `sendRpc()` were updated.
- The relay reports a Mac offline on an RPC timeout, which can produce a brief
  offline window for an overloaded-but-alive Mac. Accepted: a 20s unanswered
  tunneled request is indistinguishable from death from the phone's side, and a
  fast honest failure beats an indefinite hang.
