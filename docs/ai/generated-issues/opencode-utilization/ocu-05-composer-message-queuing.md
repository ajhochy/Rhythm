---
date: 2026-07-11
repo: Rhythm
branch: ocu-05-composer-message-queuing
status: ready-for-coding
issues: [1046]
order: 05
depends_on: []
tags: [issue, Rhythm, opencode-utilization, m1-interaction-polish]
---

# OCU-05 — Composer message queuing while the agent is busy

## Summary

The engine stores user messages submitted mid-run and the active loop picks them up. Rhythm's composer instead disables send while a session is working, forcing users to wait. This issue enables the composer during busy sessions and renders queued messages with visual feedback until the engine processes them.

## Scope (in)

- Keep the composer enabled while status=working
- On send-while-busy, deliver through the normal WS input path
- Verify apps/api_server/src/services/ws_gateway.ts does not reject input for busy sessions — remove any such guard
- Render the sent message immediately in the transcript with a subtle "queued" chip that clears when the engine's message.updated for that user message arrives
- Disable only for terminal states (error/ended) as today

## Non-goals (out)

- No queue-reordering/cancel-queued UI (YAGNI)
- No engine changes
- No changes to production user data; local agent-server (port 4001) surface only unless the spec says otherwise

## Likely files

- apps/desktop_flutter/lib/features/agents/views/agents_view.dart
- apps/desktop_flutter/lib/features/agents/controllers/agents_controller.dart
- apps/api_server/src/services/ws_gateway.ts

## Acceptance criteria

- Sending two prompts back-to-back while the agent is mid-turn results in both being answered in order, no error frames
- Queued chip appears and clears
- Composer still blocks on ended/error sessions
- flutter analyze passes

## Required tests

- Controller test for queued-state transitions
- api_server test that ws input during busy session is accepted and forwarded (promptAsync called)

## Dependencies

None
