# OPC-M3-6 — Subagent child-session navigation

**Milestone:** M3 — Session features
**Branch:** `opc-m3-6-subagent-child-sessions`
**Depends on:** OPC-M2-3

## Summary

Make the `task` tool chip (M2-3) navigable: tapping opens the child session's transcript
read-only in the main transcript area, with a breadcrumb back to the parent. Children are
discovered via `GET /session/{id}/children` (typed wrapper) and their messages fetched via the
SDK message-list; child sessions do NOT appear in the main session list (they're owned by the
parent) and accept no user input.

## Motivation

Audit B ABSENT: "subagent child-session navigation". OpenCode's task tool spawns child
sessions; today their work is invisible beyond the generic tool card, making subagent runs a
black box.

## Likely files

- `apps/api_server/src/controllers/agent_sessions_controller.ts` (children + child-messages routes)
- `apps/api_server/src/services/opencode_client_service.ts` (listChildren wrapper from M1-1)
- `apps/desktop_flutter/lib/features/agents/controllers/agents_controller.dart`
- `apps/desktop_flutter/lib/features/agents/views/agents_view.dart` (+ `_tool_renderers/_task_chip.dart`)

## Acceptance criteria

1. `GET /agent-sessions/:id/children` invokes the SDK children wrapper with the mapped sdk id and returns child session summaries (vitest spy + fixture); `GET /agent-sessions/:id/children/:childSdkId/messages` returns the child's structured messages (parts shape identical to M1-2's REST shape).
2. Tapping a `task` chip pushes a child transcript view showing the child's parts via the standard renderers (widget test with fixture).
3. The child view shows a breadcrumb "‹ parent-session-name"; tapping returns to the parent transcript at its prior scroll context (no rehydrate refetch of the parent).
4. The child view has no composer (read-only assert: composer widget absent).
5. Child sessions never appear in the sidebar session lists (controller test: children excluded from active/resumable lists).
6. While the child is streaming (subtask parts updating), the chip's status indicator updates in the parent transcript (existing ToolState path — regression assert).
7. `ai-workflow checks --level pr` exits 0; vitest + flutter test green.

## Required tests

- vitest: children routes (c1).
- flutter test: `opc_m3_6_child_sessions_test.dart` (c2-c6).

## Out of scope

- Live WS subscription to child sessions (fetch-on-open + refetch on parent task-part updates is sufficient); promoting a child to a full session.
