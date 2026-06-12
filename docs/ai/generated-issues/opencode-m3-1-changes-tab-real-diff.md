# OPC-M3-1 — Changes tab via real GET /session/{id}/diff

**Milestone:** M3 — Session features
**Branch:** `opc-m3-1-changes-tab-real-diff`
**Depends on:** OPC-M1-1, OPC-M2-3

## Summary

Fix the always-empty Changes tab: route it through the typed `getSessionDiff` wrapper (M1-1)
instead of the nonexistent duck-typed `diffSession` (agent_sessions_controller.ts:362-383).
Render per-file diffs with `_UnifiedDiffView` (M2-3), refreshing on `session.diff` /
`session.idle` events.

## Motivation

Audit B BROKEN: `getDiff` always returns `[]` — the prior agent duck-typed a method name that
doesn't exist on the SDK, and the silent fallback returned an empty array, so the Changes tab
shipped permanently empty.

## Likely files

- `apps/api_server/src/controllers/agent_sessions_controller.ts` (:362-383)
- `apps/api_server/src/services/opencode_client_service.ts` (wrapper from M1-1)
- `apps/api_server/src/services/opencode_stream_bridge.ts` (relay `session.diff` event)
- `apps/desktop_flutter/lib/features/agents/controllers/agents_controller.dart`
- `apps/desktop_flutter/lib/features/agents/views/agents_view.dart` (Changes tab)
- `apps/desktop_flutter/lib/features/agents/data/agent_sessions_data_source.dart`

## Acceptance criteria

1. `GET /agent-sessions/:id/diff` calls the typed wrapper with the mapped sdk id and returns its payload (vitest spy assert with a real-shape diff fixture: file path, additions, deletions, patch text); SDK-error → AppError 502 with message, never a silent `[]`.
2. Changes tab renders one expandable file row per diff entry (path + `+N −M` counts) using `_UnifiedDiffView` (widget test on the fixture).
3. Empty diff renders an explicit "No file changes yet" empty state (distinct from error state).
4. A `session.diff` WS event triggers a refetch for the affected session only (controller test).
5. Tab badge shows the changed-file count when nonzero.
6. `ai-workflow checks --level pr` exits 0; vitest + flutter test green.

## Required tests

- vitest: controller diff route contract (c1) — must fail on the current duck-typed code (red-proven).
- flutter test: `opc_m3_1_changes_tab_test.dart` (c2-c5).

## Out of scope

- Revert from the diff view (M3-2). VCS branch chip (already shipped). `/file/status` polling.
