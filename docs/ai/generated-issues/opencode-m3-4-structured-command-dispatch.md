# OPC-M3-4 — Slash commands dispatched via POST /session/{id}/command

**Milestone:** M3 — Session features
**Branch:** `opc-m3-4-structured-command-dispatch`
**Depends on:** OPC-M1-1

## Summary

When the user selects a slash command from the popover, dispatch it through the structured
endpoint (`dispatchCommand` wrapper from M1-1) with `{command, arguments}` instead of
submitting `/name args` as plain prompt text. Free-typed text that happens to start with `/`
but doesn't match a listed command still goes as plain text.

## Motivation

Audit B PARTIAL: "slash commands not dispatched via POST /session/:id/command" — text-prefix
injection relies on the model/server parsing the prefix and bypasses opencode's command
templating (agent/model overrides per command), so commands behave differently than in
OpenCode proper.

## Likely files

- `apps/api_server/src/services/ws_gateway.ts` (new `session.command` WS message) or a REST route in `agent_sessions_controller.ts`
- `apps/api_server/src/services/opencode_client_service.ts`
- `apps/desktop_flutter/lib/features/agents/views/_slash_command_popover.dart`
- `apps/desktop_flutter/lib/features/agents/controllers/agents_controller.dart`

## Acceptance criteria

1. A `session.command` WS frame (or POST route — implementer picks one and documents it) `{id, command, arguments}` invokes the SDK command wrapper with (sdkId, command, arguments) — vitest spy assert; unknown local id → error frame.
2. Selecting a command in the popover and submitting sends the structured frame, NOT a `session.input` with text prefix (controller test asserts message type and absence of `/cmd` text send).
3. The user's command invocation renders in the transcript as a distinct command row (`/name args`), and the streamed response parts render normally.
4. Typing `/notacommand foo` (not in `command.list`) and submitting sends plain `session.input` text (regression).
5. Command failure (SDK error) surfaces as a system error message in the transcript.
6. `ai-workflow checks --level pr` exits 0; vitest + flutter test green.

## Required tests

- vitest: gateway/route command contract (c1).
- flutter test: `opc_m3_4_command_dispatch_test.dart` (c2-c4).

## Out of scope

- Command palette (global Cmd+K). Custom user-defined command authoring UI.
