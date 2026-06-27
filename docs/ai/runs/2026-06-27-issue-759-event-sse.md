---
date: 2026-06-27
repo: Rhythm
branch: fix/issue-759-event-sse
pr: TBD
issues: [759, 751]
status: verified-pending-pr
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# #759 — fork opencode `/event` SSE collapse (real root cause of #751)

## Summary

The bundled **fork** opencode engine (1.14.49, Effect rewrite) delivered no
session/message events on its `/event` SSE stream: subscribers got
`server.connected` and then the stream collapsed within milliseconds. This is
the real cause of #751 (agent sessions stuck on "Starting", 0 messages, no
child subagent rows). Stock 1.14.40 was unaffected, which masked the
regression in dev/test runs (PATH augmentation spawns stock unless the fork is
forced).

## Root cause

`Bus.subscribeAll()` returns a lazy `Stream.unwrap(InstanceState.get(state) ->
Stream.fromPubSub(wildcard))`. `InstanceState.get` resolves the instance via
the `InstanceRef` fiber-local, which is bound only on the request **handler**
fiber (by the workspace-routing + instance-context middleware). An HTTP SSE
response **body** is pumped by a separate server fiber that never inherits that
fiber-local, so the deferred resolve failed during streaming and the stream
ended right after the synthetic `server.connected` event. The plugin consumer
of `subscribeAll()` is unaffected because it runs under `Effect.forkScoped`,
which inherits the parent fiber's context.

Log signature confirmed: `type=* subscribing -> server event connected ->
type=* unsubscribing -> server event disconnected` in ~5ms, with NO
`instance.disposed` and NO PubSub shutdown (the bus stayed alive).

## Fix

- Added `Bus.subscribeAllStream()` — an `Effect.fn` that resolves the concrete
  wildcard PubSub eagerly while the request's Instance context is still bound
  (mirrors the working `subscribeAllCallback` / `on()` path used by the TUI),
  then streams from that concrete PubSub.
- `/event` handler now `yield*`s the resolved stream inside its instance-bound
  effect and passes it to `eventResponse`. Heartbeat,
  `takeUntil(InstanceDisposed)`, and SSE encoding unchanged.
- Exported `Bus.Payload` type for the handler's stream typing (additive).

## Files changed

- `apps/opencode_fork/packages/opencode/src/bus/index.ts` — export `Payload`,
  add `subscribeAllStream` to `Interface` + impl + registration.
- `apps/opencode_fork/packages/opencode/src/server/routes/instance/httpapi/event.ts`
  — handler resolves stream eagerly; `eventResponse` takes the resolved stream.
- `apps/opencode_fork/packages/opencode/test/server/httpapi-event.test.ts`
  — regression test: boots a real `Server.listen` and asserts the `/event`
  stream stays open past `server.connected`.

## Checks run

- `npm run typecheck` (tsgo --noEmit) — PASS (0 errors)
- `bun test test/server/httpapi-event.test.ts test/bus/ test/acp/event-subscription.test.ts` — 33 pass / 0 fail
- `bun test test/server/` — 217 pass / 1 skip / 0 fail (42 files)
- Regression test **verified failing on unmodified source** (EOF at ~559ms),
  passing with the fix — not a false-green test.
- Runtime A/B against the **bundled fork engine** (`bun run ./src/index.ts
  serve`): BUG = collapse at ~5s (only `server.connected`); FIXED = stream
  stays open the full 22s, delivers `server.heartbeat` (and earlier captured a
  real `session.updated` flowing through).

## Notes / follow-ups

- Verification deliberately exercised the **fork** engine, not stock 1.14.40 —
  closes the runtime-parity gap that produced an earlier false PASS on #751.
- PR #758 (durable `sdk_session_id` fallback in the bridge reverse-lookup) is
  correct defense-in-depth for the map-miss class but does NOT fix this engine
  regression; left as-is ("refs #751").
- End-to-end in the shipped `Rhythm.app` requires a release build (the fork
  binary is lipo'd + signed by `desktop_release.yml`); that is the manual smoke
  step on this PR. Source-server runtime test is the strongest pre-build proof.
