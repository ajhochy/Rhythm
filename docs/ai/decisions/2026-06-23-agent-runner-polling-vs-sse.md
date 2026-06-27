---
date: 2026-06-23
repo: Rhythm
tags: [decision, Rhythm]
index: "[[Rhythm]]"
---

## Context

AgentRunner (#738) needs to detect when an opencode session has produced an assistant reply so it can return `result` to the caller (scheduler, cookbook run endpoint). The opencode SDK exposes two ways to get session output:

1. **SSE subscription** (`GET /session/:id/events`) — streaming, event-driven, lowest latency
2. **Message list polling** (`GET /session/:id/messages`) — pull-based, requires periodic requests

## Decision

Use polling (`listMessages()` every 500 ms) rather than SSE subscription.

## Alternatives considered

- **SSE subscription** — would require maintaining a persistent HTTP connection from within a background service function. The AgentRunner `run()` function is called fire-and-forget from the scheduler loop; there's no HTTP request context to attach a streaming response to, and managing SSE keep-alive connections inside a Node.js service (not a request handler) adds lifecycle complexity. SSE would be the right choice for a WebSocket gateway (which already exists in `ws_gateway.ts`) but not for a headless runner.
- **SDK event subscribe** — `opencode_client_service.ts` has `subscribeToEvents()` which wraps the SSE stream. Same lifecycle concern applies: it's designed for use within a WS gateway or SSE bridge, not a blocking `await run()`.

## Consequences

- **Latency**: up to 500 ms added to result detection vs. SSE. Acceptable for scheduled/batch runs where sub-second response doesn't matter.
- **Load**: one extra HTTP request every 500 ms per active run. With default cap of 3 concurrent runs, max 6 extra requests/second to the local opencode process — negligible.
- **Correctness risk**: if opencode returns an assistant message with `time.created < promptSentAt` (e.g. reused session with stale messages), the poller would exit prematurely. Mitigated by creating a fresh session per AgentRunner.run() call.
- **Future**: if AgentRunner is extended to surface streaming results live (e.g. a notification that streams partial output), this should be re-evaluated for SSE. For now the `outputTarget` enum keeps the delivery surface narrow enough that polling is correct.
