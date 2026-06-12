# OPC-M3-5 — Session todo panel

**Milestone:** M3 — Session features
**Branch:** `opc-m3-5-todo-panel`
**Depends on:** OPC-M1-2, OPC-M2-3

## Summary

Live, collapsible todo panel for the selected session: hydrate from
`GET /session/{id}/todo` (typed wrapper, proxied at `GET /agent-sessions/:id/todo`), update on
`todo.updated` SSE→WS events, render with the M2-3 checklist widget plus a progress count
("3/7") on the panel header. Panel hidden when the session has no todos.

## Motivation

Audit B ABSENT: "todo panel". OpenCode's sidebar todo list is how users track multi-step agent
work; todowrite parts scroll away in the transcript, losing the at-a-glance state.

## Likely files

- `apps/api_server/src/services/opencode_stream_bridge.ts` (relay `todo.updated`)
- `apps/api_server/src/controllers/agent_sessions_controller.ts` (GET todo route)
- `apps/api_server/src/services/opencode_client_service.ts`
- `apps/desktop_flutter/lib/features/agents/controllers/agents_controller.dart` (`_todosBySession`)
- `apps/desktop_flutter/lib/features/agents/views/agents_view.dart` (panel)

## Acceptance criteria

1. `GET /agent-sessions/:id/todo` invokes the SDK todo wrapper and returns the list (vitest spy + real-shape fixture).
2. The bridge relays a `todo.updated` SSE event as a WS frame carrying session id + todo list (vitest).
3. Selecting a session fetches todos once and renders the panel when nonempty; empty list → no panel (widget tests).
4. A `todo.updated` WS frame replaces the session's todo state and the panel re-renders (controller test: state keyed per session — an update for session B does not touch session A).
5. Panel header shows completed/total count; rows reuse the M2-3 checklist styling with status-driven check state.
6. Panel collapse state persists while switching between sessions in the same app run.
7. `ai-workflow checks --level pr` exits 0; vitest + flutter test green.

## Required tests

- vitest: todo route + bridge relay (c1-c2).
- flutter test: `opc_m3_5_todo_panel_test.dart` (c3-c6).

## Out of scope

- User-editable todos (read-only mirror of agent state). Cross-session todo aggregation.
