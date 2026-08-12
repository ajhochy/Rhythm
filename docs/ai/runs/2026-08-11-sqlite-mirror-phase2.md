---
date: 2026-08-11
repo: Rhythm
branch: mobile/mirror-event-fanout
pr: https://github.com/ajhochy/Rhythm/pull/1386
issues: [1379]
status: implemented — Phase 2 transport landed
tags: [run, Rhythm]
---

# Mobile smart-client Phase 2: fan out the bridge's events instead of one engine SSE per phone

Implements `docs/ai/plan-mobile-smart-client.md` Phase 2. Branched off `main`
(`23c51f12`), **not** off PR #1384 — Phase 1 is reads, Phase 2 is the stream, and
they only overlap in one file (`mobile_sse_proxy.ts`, see "Merge surface").

## The constraint the previous run deferred on, and how it is fixed

The Phase 1 run log put it exactly right:

> `ws_gateway.broadcast()` only fans out to the loopback `/ws/agents` client
> set, so mobile receives none of the bridge's already-persisted frames today.

That is true, and it stays true — `broadcast()` is **not** the thing to widen.
It emits the desktop DTO (`{v:1, type:'session.status', …}`), which is a
Rhythm-invented shape. The phone parses the **engine's own** event shape, and
the whole reason mirror-served reads needed no re-pair is that they stay behind
already-fingerprinted engine contracts. Pushing `{v:1,…}` frames at the phone
would have moved it off that contract for the sake of reusing a function name.

So the fan-out is added one layer *upstream* of `broadcast()`, where the frames
are still engine-shaped: `OpencodeStreamBridge._listenGlobal` already consumes
the single consolidated `/global/event` stream and persists every frame. It now
also republishes each frame to a new in-process hub, and `MobileSseProxy`
subscribes to that hub instead of dialing `127.0.0.1:4096` per device.

Net effect: **N phones cost zero engine connections.** Before, each phone opened
its own `/global/event` stream and blocked on engine liveness to do it.

## Files

| File | Change |
|---|---|
| `apps/api_server/src/services/opencode_event_hub.ts` | **New.** Process-wide fan-out of `{directory, payload}` envelopes. Per-subscriber bounded queue (512 default); a subscriber that cannot keep up overflows and is dropped rather than growing the api_server heap. `publish()` never throws, so no subscriber can stall the bridge loop. `isLive()` is a synchronous flag — see decision 8. |
| `apps/api_server/src/services/opencode_stream_bridge.ts` | `_listenGlobal` publishes every frame to the hub — heartbeats before the swallow, everything else **after** `_relayEvent`, so the mirror write lands first. New `_publishToHub` reassembles the `{directory, payload}` envelope from the SDK's flattened `{...payload, __directory}`. `ensureGlobalStream` marks the hub live; `stopAll` marks it not-live. |
| `apps/api_server/src/services/mobile_sse_proxy.ts` | Prefers the hub; falls back to the unchanged per-device engine SSE when the hub cannot serve. Per-event filtering/dedupe/shaping/backpressure extracted into one `deliver()` used by **both** transports, so they cannot drift apart. New `writeGatewayError()` shared by both. New `maxHubQueue` option. |

No mobile-client change. The envelope on the wire is byte-identical, which is
the point: the phone's `readSseEnvelopes` consumer and the pinned
`contractFingerprint` are both untouched.

## Tests

| File | Cases |
|---|---|
| `src/__tests__/issue_1379_mobile_event_fanout.test.ts` | 14 — hub-served device with the engine fetch asserted **never called**; one publish reaching two devices; owner/project/no-directory fail-closed scoping; `/sessions/:id/events` narrowing; event-id dedupe; heartbeat pass-through; queue overflow → `gateway.error STREAM_BACKPRESSURE`; device-revocation teardown; fall-back-to-engine when the hub is not live; publish isolation. |
| `src/__tests__/issue_1379_bridge_hub_publish.test.ts` | 4 — driven through the real `OpencodeStreamBridge` against a real SQLite DB: envelope reassembly (`__directory` must not leak into the payload), hub marked live on subscribe, hub left unavailable when the engine subscribe fails, and a **persist-before-publish** ordering proof that reads the mirror at the instant of fan-out. |

## Decisions taken autonomously

### 1. Fan out at the envelope, not through `broadcast()`

See above. `broadcast()` keeps serving the desktop DTO to loopback clients
unchanged. The mobile fan-out is a second, parallel path from the same producer.

### 2. Fail soft, never fail closed, on hub unavailability

Three ways the hub can be unable to serve: `RHYTHM_SSE_GLOBAL=0` (legacy
per-directory mode), an engine binary with no `/global/event`, or a subscribe
failure. In all three the proxy takes the **unchanged** per-device engine path.
The alternative — a phone subscribing to a hub with no producer — is a silently
dead stream, which is worse than the status quo it replaces.

### 3. Liveness survives a watchdog resubscribe, but not a shutdown

`ensureGlobalStream` sets live; `resubscribeGlobalStream` does not clear it.
That is deliberate: during an engine restart a phone should ride out a quiet
stream (the bridge is already resubscribing on its behalf) rather than fall back
to hammering a dead engine. `stopAll` — a real shutdown — does clear it, so a
*new* stream opened afterwards goes back to its own transport.

### 4. Heartbeats are republished even though the bridge swallows them

`server.heartbeat` / `server.connected` carry no session and produce no desktop
frame, so `_listenGlobal` drops them. Mobile needs them: they are the only
traffic on an idle stream, and `opencode-provider.tsx` will not stand its 5s
polling fallback down until it has seen at least one envelope. They are
published before the swallow.

### 5. Backpressure is a queue bound, not an unbounded buffer

Each subscriber gets a bounded queue. Overflow closes that subscriber and
surfaces as the **existing** `STREAM_BACKPRESSURE` / `gateway.error` frame the
phone already handles — no new error code, no client change. The one slow phone
is dropped; the bridge and every other subscriber are unaffected.

### 6. No reconnect-replay buffer — the phone already re-reads on connect

The plan asked for "replay missed frames from the mirror by `sdk_message_id`".
Reading `opencode-provider.tsx` shows its subscribe loop already awaits
`refreshSessions` / `refreshCurrentSession` / `refreshPendingInteractions` /
`refreshArchivedSessions` on **every** (re)connect, before consuming a single
envelope. A backgrounded phone therefore catches up from the mirror by
re-reading it, which is a strictly stronger guarantee than replaying a bounded
in-memory window — and with Phase 1 those re-reads are themselves mirror-served.
A replay ring would be a second, weaker path to the same property, plus new
cursor state on the stream, plus a client change to send `Last-Event-ID`. Not
built.

### 7. The device connect path does not start the stream

The first shape of this had `MobileSseProxy.stream()` await an
`ensureGlobalFanout()` that would start the consolidated stream on demand. Two
problems, both caught by `issue_1170_mobile_realtime_proxy.test.ts`: it put a
real engine round-trip on *every* device connect (paid in full, per phone,
whenever the engine is down), and it inserted an async hop before the transport
was chosen — which is an observable behavior change on the fallback path.

Removed. `server.ts` already calls `ensureGlobalStream()` on engine-ready, and
`streamSession` calls it too, so the stream is running whenever the engine is.
The proxy now reads a synchronous `isLive()` flag and the fallback path is
byte-for-byte the old one. If the engine has never been ready, mobile falls back
to per-device engine SSE — exactly the pre-Phase-2 behavior, not a regression.

### 8. Optimistic send is still not in this PR

The plan pairs optimistic outgoing bubbles with Phase 2 because the reply then
streams from the smart server's state — which is now true. But it is a mobile
**chat-UI** change (local bubble insert + reconcile against the engine's
`message.updated(role=user)` echo + dedupe), not a transport change, and nothing
in it depends on this PR's code. Keeping it out keeps this PR's blast radius to
the api_server. Worth its own issue.

## Merge surface with PR #1384

One file overlaps: `mobile_sse_proxy.ts`. #1384 (Phase 0) adds a bounded,
classified scope-check pre-check at the **top** of `stream()`; this PR replaces
the **transport loop** below it and factors `deliver()` out of `consume()`. The
regions are disjoint but adjacent — expect a textual conflict in the imports and
around `stream()`, resolved by keeping #1384's pre-check block verbatim and this
PR's transport selection verbatim. Neither changes the other's behavior.

## Checks

`python3 scripts/run_ai_workflow.py checks --level pr` — 15 of 16 checks green:
flutter analyze · dart format · api_server tsc · mcp_server tsc · flutter test ·
api_server lint · api_server build · mcp_server vitest · mcp_server build ·
opencode fork typecheck · opencode fork session tests · mobile static suite ·
mobile contract · mobile fake-server self-test · mobile web e2e.

The 16th — the serial api_server gate — reported one failure inside the
`checks` run (`agent_configs_routes.test.ts > creates a config with validated
corePermissionsJson`, 404 instead of 201). Re-run standalone on the same tree:

```
npm test --silent -- --fileParallelism=false
→ 524 test files / 4311 tests passed, 103 files + 161 tests skipped, exit 0
```

It also passes in isolation (44/44). Nothing here touches agent-configs routes
or their auth. This is the shared-state ordering class the repo documents on
`PR_CHECKS` (#755/#1088), not a regression from this work.

**New coverage: 18 cases across 2 files.**

### A defect found by test, not by review

The first implementation had the proxy `await` an on-demand
`ensureGlobalFanout()` before choosing a transport.
`issue_1170_mobile_realtime_proxy.test.ts` caught it immediately — two of its
cases assert that `stream()` reaches the engine and that a close mid-flight
aborts the upstream signal, and the extra async hop meant the close landed
first. That was not just a test-timing coupling: it also meant every device
connect paid a real engine round-trip to discover the engine was down. See
decision 7.

## Notes

- **What actually gets faster/safer.** Opening the event stream no longer
  requires a reachable engine; a second phone costs nothing; an engine restart
  no longer tears down every phone's stream independently (they ride the
  bridge's own resubscribe).
- **Security posture is unchanged by construction.** Both transports funnel
  through one `deliver()`, which applies `mobileSseEventBelongsToOwner`, the
  optional session narrowing, the dedupe LRU, and `shapeMobileSseEvent`
  host-path scrubbing. A test publishes an envelope with **no** `directory` and
  asserts it is dropped — the fail-closed rule the hub must not weaken.
- **Residual: `_relayEvent` is not the persistence boundary for every event
  type.** Parts and message info are written synchronously before publish;
  a few handlers (generated-media registration) write asynchronously and can
  land after fan-out. The phone re-reads on reconnect, so this is a
  freshness detail, not a correctness one — but it is why the ordering claim in
  the test is scoped to message parts.
- **Follow-ups worth filing:** optimistic send (above); mirror child message
  parts (Phase 3, carried over from Phase 1); dispatch queue so even submit does
  not block on a saturated engine.
