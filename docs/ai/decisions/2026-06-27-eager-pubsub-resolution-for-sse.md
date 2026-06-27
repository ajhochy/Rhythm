---
date: 2026-06-27
repo: Rhythm
tags: [decision, Rhythm]
index: "[[Rhythm]]"
---

# Resolve Instance-scoped streams eagerly before returning an HTTP SSE body

## Context

The fork opencode engine's `/event` SSE stream collapsed right after
`server.connected` because `Bus.subscribeAll()` deferred `InstanceState.get`
(which reads the `InstanceRef` fiber-local) until stream consumption. The HTTP
response body is pumped by a server fiber that does not inherit the handler's
`InstanceRef`, so the lazy resolve failed mid-stream. (#759)

## Decision

For any Instance/fiber-local-scoped resource that backs an HTTP response body
(SSE, chunked streaming), resolve the concrete resource (e.g. the wildcard
PubSub) **eagerly inside the request handler effect**, where the request's
`InstanceRef`/`WorkspaceRef` are bound, then stream from the concrete handle.
Do not return a `Stream.unwrap(InstanceState.get(...))` that defers resolution
to the consuming fiber. Implemented as `Bus.subscribeAllStream()` (an
`Effect.fn`), mirroring the existing `subscribeAllCallback`/`on()` pattern the
TUI already relied on.

## Alternatives considered

- **Capture handler context and `InstanceState.bind` the stream's effects** —
  works but heavier and less obvious than eager resolution; the callback path
  already proves eager resolution is the idiom.
- **Make the consuming fiber inherit `InstanceRef`** — requires changing the
  HTTP framework's response-body fiber handling; out of scope and fragile.
- **Leave lazy, harden only the Rhythm bridge (PR #758)** — addresses the
  map-miss symptom class but not the engine regression; events still never
  arrive.

## Consequences

- `/event` streams session/message events again; agent sessions leave
  "Starting", messages persist, child subagent sessions appear.
- New idiom for instance-scoped SSE in the fork: resolve eagerly in the
  handler. `subscribeAll()` (lazy) remains valid for `Effect.forkScoped`
  consumers that inherit context (e.g. the plugin bus subscriber).
- Verification for opencode-engine changes must run against the **bundled
  fork** engine, not stock 1.14.40 (PATH augmentation hides the fork).
