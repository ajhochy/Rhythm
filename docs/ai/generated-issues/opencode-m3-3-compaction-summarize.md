# OPC-M3-3 — Compaction (summarize) with UI affordance

**Milestone:** M3 — Session features
**Branch:** `opc-m3-3-compaction-summarize`
**Depends on:** OPC-M1-1, OPC-M1-3

## Summary

Add a "Compact session" action (session header overflow menu) that calls
`POST /session/{id}/summarize` via the typed wrapper, plus first-class rendering of
`compaction` parts (a horizontal "Conversation compacted" divider with the summary expandable
beneath). Show a context-usage hint near the composer when the session's input tokens approach
the model's limit, suggesting compaction.

## Motivation

Audit A ranks compaction in the TUI top-15; long-running church-task sessions will hit context
limits, and today the only recovery is abandoning the session.

## Likely files

- `apps/api_server/src/services/opencode_client_service.ts` (summarize wrapper)
- `apps/api_server/src/controllers/agent_sessions_controller.ts` (POST route)
- `apps/desktop_flutter/lib/features/agents/views/agents_view.dart` (menu + compaction divider)
- `apps/desktop_flutter/lib/features/agents/controllers/agents_controller.dart`

## Acceptance criteria

1. `POST /agent-sessions/:id/summarize` invokes the SDK summarize wrapper with the mapped sdk id (vitest spy); errors surface as AppError, not silence.
2. Session header menu contains "Compact session"; tapping dispatches the call and shows a working indicator until the resulting compaction part/message arrives (widget test, mocked source).
3. A `compaction` part (real-shape fixture) renders as a divider row labeled "Conversation compacted", with the summary text hidden until expanded.
4. Compaction parts arriving via stream and via rehydration render identically.
5. When the last assistant message's input-token count exceeds a configurable threshold fraction of the model's context (default 0.8, constant), a hint chip appears near the composer; below threshold it does not (widget test both sides).
6. `ai-workflow checks --level pr` exits 0; vitest + flutter test green.

## Required tests

- vitest: summarize route contract (c1).
- flutter test: `opc_m3_3_compaction_test.dart` (c2-c5).

## Out of scope

- Automatic compaction. Per-model context-limit catalog beyond what the provider list already exposes (if absent, criterion 5's threshold uses a fixed 150k-token default and says so in code comment).
