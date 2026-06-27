---
index: "[[Rhythm]]"
date: 2026-06-13
repo: rhythm
tags: [decision, rhythm]
---

# Slash command dispatch uses WS `session.command` frame, not a new REST route (#697)

**Context:** Issue #697 title says "POST /session/{id}/command"; needed to choose between a new REST route and a WebSocket frame for dispatching slash commands from the Flutter client to the server.

**Decision:** WS frame `{v:1, type:'session.command', id: localSessionId, command: string, arguments: string}` via the existing `handleClientMessage` switch in `ws_gateway.ts`. Server handler (`handleCommandFrame`) is exported so it can be tested directly in vitest without a live WS connection.

**Alternatives considered:**
- REST POST `/agent-sessions/:id/command`: Requires a new route + controller method + data-source HTTP call in Flutter. Adds latency (new round-trip vs. reusing open socket). Every other user-initiated session action (`session.input`, `session.resize`, `session.permission.respond`) already uses WS frames — inconsistency would be hard to justify.
- gRPC or SSE: Out of scope and over-engineered for this single addition.

**Consequences:** The frame is fire-and-forget (same as `promptAsync`). The Flutter `AgentsDataSource.dispatchCommand` stub exists for interface completeness but the actual dispatch is via `repository.send(...)`. The `dispatchCommand` repo method is still useful for test doubles that need to intercept the call at a higher level.
