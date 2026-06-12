# OPC-M1-3 — Flutter rehydrates parts from REST; delete the legacy dual render path

**Milestone:** M1 — Foundation
**Branch:** `opc-m1-3-flutter-rehydration-single-path`
**Depends on:** OPC-M1-2

## Summary

`_chatMessagesBySession` becomes a cache of the server's structured transcript: on session
select, reconnect, and app restart, Flutter fetches `GET /agent-sessions/:id/messages` and
rebuilds parts-based chat state. The legacy plain-text transcript render branch is **deleted**
everywhere — main transcript body, mini-bubble overlay, and stuck-detection — leaving exactly
one render path.

## Motivation

Root cause 1 (client half): reconnected sessions always fall back to the legacy plain-text path
because `_chatMessagesBySession` was in-memory only; the mini-bubble always used the legacy
path; `_recomputeStuck` reads the legacy `_liveOutputBuffer` so parts-based sessions are
falsely flagged "stuck".

## Scope

- Rehydration: `selectSession()` / WS reconnect / `initialize()` for resumable sessions fetch structured messages and populate `_chatMessagesBySession` + `_chatPartsByMessage`. Optimistic local rows (user input) reconcile by sdk message id on next hydrate.
- Delete: `_transcriptsBySession`-driven rendering in `agents_view.dart` `_buildTranscriptBody` (the hasChat=false branch), the mini-bubble's legacy transcript read, `_liveOutputBuffer`. System/error WS frames become synthetic system-role chat messages (preserving the #638 behavior) instead of legacy transcript rows.
- Stuck-detection: `_recomputeStuck` keys off parts state (last part activity timestamp / session status) instead of `_liveOutputBuffer`.
- Delete Flutter's `_kProviderToAgentKind` duplicate; consume the mapping from `GET /agents/capabilities` (M1-1 criterion 6), with the current map as offline fallback.

## Likely files

- `apps/desktop_flutter/lib/features/agents/controllers/agents_controller.dart`
- `apps/desktop_flutter/lib/features/agents/views/agents_view.dart`
- `apps/desktop_flutter/lib/app/core/agents/agent_bubble_overlay.dart`
- `apps/desktop_flutter/lib/features/agents/data/agent_sessions_data_source.dart` (structured messages fetch)
- `apps/desktop_flutter/lib/features/agents/models/*` (ChatMessage/ChatPart fromJson for the REST shape)

## Acceptance criteria

1. Selecting a session with an existing server transcript (controller test with fake data source returning a structured payload incl. text+tool+reasoning parts) populates `_chatMessagesBySession` with the same message/part structure — no plain-text fallback.
2. After simulated WS reconnect, the transcript renders from rehydrated parts: widget test asserts a tool part renders the tool card (not raw text) post-reconnect.
3. Repo-wide grep: `_liveOutputBuffer` has zero references; `_buildTranscriptBody` has a single render branch (no hasChat conditional on transcript store).
4. Mini-bubble renders from `_chatMessagesBySession` (widget test: bubble shows the latest assistant text part for a non-selected session).
5. A streaming parts-based session is not flagged stuck while parts are arriving; a session with no part activity for the stuck threshold in `starting` status is flagged (unit tests on the extracted pure stuck predicate).
6. WS error frames appear as system-role chat messages in the (single) transcript path.
7. Flutter's provider→agent-kind map is fetched from capabilities; badge tests from issue #645 still pass.
8. `flutter test` full suite green; `ai-workflow checks --level pr` exits 0.

## Required tests (flutter test)

- New `test/features/agents/opc_m1_3_rehydration_test.dart` (criteria 1, 2, 5, 6).
- New/updated bubble test for criterion 4.
- Update existing agents suite tests that referenced the legacy path (expected churn; do not weaken assertions — port them to the parts path).

## Out of scope

- No new part-type renderers (M2) — unknown part types render via the existing generic card.
- No resume/continuity change (M1-5).
- Mini-bubble is kept, not redesigned (plan open question 3).
