---
date: 2026-08-11
repo: Rhythm
branch: mobile/sqlite-mirror-phase2
pr: TBD
issues: [1379]
status: implemented — Phase 2 (event fan-out); server-side only
tags: [run, Rhythm]
---

# Mobile smart-client Phase 2: SSE fan-out from the consolidated engine stream

Implements `docs/ai/plan-mobile-smart-client.md` Phase 2 (#1379b), the half
deferred by PR #1384. Phase 1 made mobile *reads* engine-independent; this
makes the *live stream* engine-independent too.

Branched from `main`, not from #1384 — the two are independent and #1384 merges
separately. No file touched here overlaps with Phase 1's diff.

## The one-line change

Every paired phone used to open its own engine SSE stream. Now they all ride
the single consolidated `/global/event` subscription the bridge already holds.
**N phones went from N engine streams to zero additional ones.**

## Why `ws_gateway.broadcast()` was the wrong pipe

The Phase 1 run log flagged that `broadcast()` "only reaches loopback clients"
and treated that as the Phase 2 blocker. It is true but it is not the thing to
fix, and fixing it would have been wrong:

`broadcast()` writes **Rhythm-native desktop DTOs** (`{v:1, type:'session.status', …}`)
to the `/ws/agents` client set. Mobile does not speak that protocol at all — it
speaks the **engine's own event shape**, which is what keeps it inside the
`contractFingerprint`-pinned surface. Reshaping desktop frames for mobile would
have moved the phone off the pinned engine event contract and forced a re-pair
of every device.

The loopback restriction is also deliberate, not incidental: `/ws/agents` is a
`AGENT_LOCAL`-bypassed surface with no per-user ownership filter, guarded by
`isAllowedLocalAgentSurfaceRequest` + an actual-loopback socket check. Widening
it to reach phones over Tailscale would have punched a hole straight through
the gateway's auth boundary to deliver frames mobile cannot parse.

So `broadcast()` is left exactly as it is. The fan-out was added one layer
lower, where the frames are still engine-shaped.

## Files

| File | Change |
|---|---|
| `apps/api_server/src/services/mobile_event_bus.ts` | **New.** In-process fan-out of raw `/global/event` envelopes. Per-subscriber bounded queue; a slow subscriber overflows and is failed rather than growing the heap or stalling the producer. Tracks producer liveness so consumers know when to fall back. |
| `apps/api_server/src/services/opencode_client_service.ts` | `subscribeToGlobalEvents` publishes each **raw envelope** to the bus and marks the producer live/dead. Publication happens before the `!envelope.payload` filter and before unwrapping, so the bus carries byte-equivalent values to what the wire path parsed. |
| `apps/api_server/src/services/mobile_sse_proxy.ts` | Prefers the bus when a producer is live; keeps the direct engine stream as fallback. Per-event filtering/dedupe/shaping/backpressure extracted into one shared `deliver()` used by both sources. |

## Decisions taken (autonomously, per instruction)

### 1. Fan-out point: the SDK wrapper, not the bridge

Publishing from `OpencodeStreamBridge._listenGlobal` was the obvious spot and is
wrong for two reasons:

- The bridge **swallows `server.heartbeat` / `server.connected`** before relaying.
  Those are the phone's only traffic on an idle stream and its liveness signal.
  Tapping after that filter silently removes the keepalive.
- The bridge sees the **unwrapped** event (`{...payload, __directory}`). The
  mobile project filter is fail-closed on a top-level `directory` field, so the
  envelope would have to be reassembled — reconstructing what was just
  destructured, and dropping the envelope's `project`/`workspace` fields.

`subscribeToGlobalEvents` is the last point where the raw envelope still exists.

### 2. Ordering: publish before persist, deliberately

The plan says frames are "persisted to SQLite before broadcast". Publishing at
the SDK wrapper inverts that for the mobile path. Accepted, because:

- The gap is microtasks — the publish and the bridge's `_relayEvent` are the
  same await chain.
- The consequence of losing that race is a phone receiving a frame slightly
  before the mirror row lands. The phone re-reads the transcript from the mirror
  on open (Phase 1), so this self-corrects.
- The alternative costs the heartbeat keepalive, which is a real, continuous
  failure rather than a theoretical racy one.

### 3. Reconnect replay: not frame synthesis

The plan asks for replay of missed frames by `sdk_message_id`/cursor. Not built,
and this is a deliberate scope call rather than an omission:

The mirror stores **messages**, not engine event ids. Replay-by-event-id is not
possible from it; replay would mean *synthesizing* `message.updated` /
`message.part.updated` frames out of mirrored rows — a second, divergent
renderer of data the phone already re-reads from the mirror on open via Phase 1.
That is the duplication the mirror was built to remove.

What Phase 2 does deliver for a backgrounded phone is better than before: the
downstream connection **survives** an engine restart (the bus goes quiet, the
loop waits, the socket stays open) instead of dropping and re-running a 30s
scope pre-check. If measured device evidence later shows a real gap, replay
should be its own issue against the mirror's message cursor, not the event id.

### 4. Fallback retained, not replaced

The direct engine stream stays for three live cases: `RHYTHM_SSE_GLOBAL=0`, an
engine build without `/global/event`, and an api_server that has not started a
session yet. Default-on-fallback also means every existing SSE test keeps
exercising the wire path unchanged.

### 5. Zero mobile-client change

`MobileSseProxy` already sits behind `/mobile-gateway/events`; the phone never
talked to the engine directly, the *gateway* did on its behalf. So this is
entirely server-side: **no fingerprint change, no re-pair, no app update.**
The `expo/fetch` SSE consumer (#1287) is untouched, so RN's XHR-fetch streaming
constraint is unaffected.

### 6. Backpressure isolation

A slow phone must never exert backpressure on the producer — the same stream
drives SQLite persistence for *every* session, so blocking it would stall
transcript writes system-wide. `publishGlobalEvent` is synchronous and
non-blocking; an over-budget subscriber drops its backlog and fails with the
existing `STREAM_BACKPRESSURE` code. Pinned by a test that publishes 10,000
events to a subscriber that never reads and asserts the publish loop stays
under a second.

## Checks

| Check | Result |
|---|---|
| `tsc --noEmit` (api_server) | exit 0 |
| `npm run build` (api_server) | exit 0 |
| New suite `issue_1379_mobile_event_fanout.test.ts` | 8/8 passed |
| Related existing suites (1170 / 1070 / 1283 / 1285 / 1175 ×3 / client_service) | 91 passed, 1 skipped |
| Full api_server suite, serial | 4303 passed / 1 failed / 161 skipped |

**Mutation-verified.** Forcing the proxy back onto the engine path
(`false && globalEventProducerLive()`) fails 4 of the 8 new tests, including
"contacts the engine zero times". The tests fail without the implementation.

**The single full-suite failure is a pre-existing flake, not a regression.**
Attributed by running the same full serial suite on the clean `main` baseline
with this branch's changes stashed: **baseline fails 2 tests, this branch fails
1, and the three failures do not overlap at all.**

- baseline: `scheduled_task_columns_contract` (model-c5), `skill_names_alignment` (issue-798-c5)
- this branch: `opc_mcp_curated_credentials` (mcp-7-c8)

All three pass in isolation. This is the shared-state ordering class the repo
already documents on `PR_CHECKS` (#755/#1088) — the same class the Phase 1 run
log recorded for `dashboard_summary`. Nothing here touches schedules, skills, or
MCP credentials.

Flutter checks were not run: this branch contains **zero** Dart changes.

## Notes

- **Restored `docs/ai/plan-mobile-smart-client.md`.** Both the Phase 1 run log
  and the decision record cite it, but it was never committed to `main` — it
  existed only on `bddd22d3`. Recovered onto this branch so the reference
  resolves.
- **Security invariants held on the new source.** Ownership, project scoping,
  and host-path scrubbing are not re-implemented for the bus — both sources go
  through the identical `deliver()`, so the filters cannot drift. Pinned by a
  test asserting a foreign-directory frame is dropped and that the host path
  never appears in mobile output.
- **A drain that gives up now stops the stream** instead of writing remaining
  buffered frames into an ended socket. This was a latent bug in the pre-existing
  `consume()` that the `deliver()` extraction surfaced; guarded on both paths.
- **#1379's remaining acceptance is still device-only.** Its criteria ask for
  measured cold-start timings on a physical device over a remote gateway. This
  PR does not close #1379.

## Session note — concurrent-agent collision

A second Claude Code session was independently implementing this same phase in
the same working directory during this run, reaching a near-identical design
(`opencode_event_hub.ts`) and creating branch `mobile/mirror-event-fanout`. Its
work was left untouched; this work was moved into an isolated git worktree to
avoid clobbering. Worth knowing when reconciling the two branches — they solve
the same problem the same way and should not both land.
