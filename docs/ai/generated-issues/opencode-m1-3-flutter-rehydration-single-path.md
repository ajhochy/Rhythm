# OPC-M1-3 — Flutter rehydrates parts from REST; delete the legacy dual render path

**Milestone:** M1 — Foundation
**Branch:** `opc-m1-3-flutter-rehydration-single-path`
**Depends on:** OPC-M1-2

## Summary

`_chatMessagesBySession` becomes a cache of the server's structured transcript: on session
select, reconnect, and app restart, Flutter fetches `GET /agent-sessions/:id/messages` and
rebuilds parts-based chat state. The legacy plain-text transcript render branch is **deleted**
everywhere — main transcript body and stuck-detection — leaving exactly one render path.

**Scope change (user decision 2026-06-12, plan open question 3):** the floating mini-bubble
overlay is **deleted entirely**, not migrated. Sessions surface only in the Agents tab.

## Motivation

Root cause 1 (client half): reconnected sessions always fall back to the legacy plain-text path
because `_chatMessagesBySession` was in-memory only; the mini-bubble always used the legacy
path; `_recomputeStuck` reads the legacy `_liveOutputBuffer` so parts-based sessions are
falsely flagged "stuck".

## Scope

- Rehydration: `selectSession()` / WS reconnect / `initialize()` for resumable sessions fetch structured messages and populate `_chatMessagesBySession` + `_chatPartsByMessage`. Optimistic local rows (user input) reconcile by sdk message id on next hydrate.
- Delete: `_transcriptsBySession`-driven rendering in `agents_view.dart` `_buildTranscriptBody` (the hasChat=false branch), `_liveOutputBuffer`. System/error WS frames become synthetic system-role chat messages (preserving the #638 behavior) instead of legacy transcript rows.
- Delete the mini-bubble overlay: `agent_bubble_overlay.dart`, its `overlay_controller.dart` wiring, and every call site. The trigger-fired flow (AgentTriggerWatcher → task-collaboration session) must still work without it: the existing desktop notification path stays, and the session appears in the Agents tab list. If trigger handling currently *requires* a bubble API, replace with a no-op surface + follow-up issue rather than expanding scope here.
- Stuck-detection: `_recomputeStuck` keys off parts state (last part activity timestamp / session status) instead of `_liveOutputBuffer`.
- Delete Flutter's `_kProviderToAgentKind` duplicate; consume the mapping from `GET /agents/capabilities` (M1-1 criterion 6), with the current map as offline fallback.

## Likely files

- `apps/desktop_flutter/lib/features/agents/controllers/agents_controller.dart`
- `apps/desktop_flutter/lib/features/agents/views/agents_view.dart`
- `apps/desktop_flutter/lib/app/core/agents/agent_bubble_overlay.dart` (DELETE)
- `apps/desktop_flutter/lib/app/core/agents/overlay_controller.dart` (DELETE or trim to non-bubble duties)
- `apps/desktop_flutter/lib/app/core/agents/agent_trigger_watcher.dart` (decouple from bubble surface)
- `apps/desktop_flutter/lib/features/agents/data/agent_sessions_data_source.dart` (structured messages fetch)
- `apps/desktop_flutter/lib/features/agents/models/*` (ChatMessage/ChatPart fromJson for the REST shape)

## Acceptance criteria

1. Selecting a session with an existing server transcript (controller test with fake data source returning a structured payload incl. text+tool+reasoning parts) populates `_chatMessagesBySession` with the same message/part structure — no plain-text fallback.
2. After simulated WS reconnect, the transcript renders from rehydrated parts: widget test asserts a tool part renders the tool card (not raw text) post-reconnect.
3. Repo-wide grep: `_liveOutputBuffer` has zero references; `_buildTranscriptBody` has a single render branch (no hasChat conditional on transcript store).
4. Mini-bubble overlay fully removed: `agent_bubble_overlay.dart` deleted, repo-wide grep shows zero references to it (and to `AgentBubbleEntry`); a fired trigger still produces a visible session row in the Agents tab and the existing desktop notification (controller test).
5. A streaming parts-based session is not flagged stuck while parts are arriving; a session with no part activity for the stuck threshold in `starting` status is flagged (unit tests on the extracted pure stuck predicate).
6. WS error frames appear as system-role chat messages in the (single) transcript path.
7. Flutter's provider→agent-kind map is fetched from capabilities; badge tests from issue #645 still pass.
8. `flutter test` full suite green; `ai-workflow checks --level pr` exits 0.

## Required tests (flutter test)

- New `test/features/agents/opc_m1_3_rehydration_test.dart` (criteria 1, 2, 5, 6).
- Trigger-flow test for criterion 4 (no bubble; session row + notification still fire).
- Delete bubble-specific tests; update existing agents suite tests that referenced the legacy path (expected churn; do not weaken assertions — port them to the parts path).

## Out of scope

- No new part-type renderers (M2) — unknown part types render via the existing generic card.
- No resume/continuity change (M1-5).
- No replacement surface for the bubble (nav badge, dock bounce, etc.) — if the trigger flow
  feels under-surfaced without it, file a follow-up issue rather than designing one here.
