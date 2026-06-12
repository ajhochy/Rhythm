# OPC-M3-2 — Undo: revert / unrevert UI

**Milestone:** M3 — Session features
**Branch:** `opc-m3-2-revert-unrevert`
**Depends on:** OPC-M3-1

## Summary

Expose OpenCode's undo: a "Revert to here" action on assistant messages calls
`POST /session/{id}/revert` (typed wrapper) with the message id; a session-level "Restore
reverted changes" banner calls `/unrevert`. Reverted messages render dimmed with a "reverted"
badge; the Changes tab refreshes after either action. Revert requires a confirmation dialog
(it rewrites files in the user's cwd).

## Likely files

- `apps/api_server/src/services/opencode_client_service.ts` (revert/unrevert wrappers, M1-1 stubs)
- `apps/api_server/src/controllers/agent_sessions_controller.ts` (new POST routes)
- `apps/desktop_flutter/lib/features/agents/views/agents_view.dart` (+ `_message_actions_row.dart`)
- `apps/desktop_flutter/lib/features/agents/controllers/agents_controller.dart`
- `apps/desktop_flutter/lib/features/agents/data/agent_sessions_data_source.dart`

## Acceptance criteria

1. `POST /agent-sessions/:id/revert` body `{messageId}` invokes the SDK revert wrapper with (sdkId, messageId) — vitest spy assert; `POST /agent-sessions/:id/unrevert` likewise; SDK errors → AppError with message.
2. Message action row on assistant messages includes "Revert to here"; tapping shows a confirmation dialog naming the consequence ("Undo file changes after this point"); confirm dispatches the call; cancel does not (widget tests, mocked data source).
3. After a successful revert, messages after the revert point render with the reverted treatment (dimmed + badge) based on the session's revert state from the SDK/refetched messages, and a "Restore reverted changes" banner is visible.
4. Tapping the banner dispatches unrevert and clears the reverted treatment on success.
5. Both actions trigger a Changes-tab diff refetch (controller test).
6. `ai-workflow checks --level pr` exits 0; vitest + flutter test green.

## Required tests

- vitest: revert/unrevert route contracts (c1).
- flutter test: `opc_m3_2_revert_test.dart` (c2-c5).

## Out of scope

- Fork/timeline browsing (M4-2). Snapshot part rendering beyond the existing generic card.
