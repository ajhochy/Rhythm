---
date: 2026-06-27
repo: Rhythm
branch: fix/issue-761-agents-ui-render
pr: TBD
issues: [761, 762, 759, 751]
status: verified-pending-smoke
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# #761 — agents UI renders assistant response live from streaming parts

## Summary

After the #759 engine fix made `/event` stream again, smoke showed the session
leaving "Starting" and messages persisting in the DB — but the Flutter UI still
showed "No messages yet" until the user switched sessions and back. Root cause:
the fork engine delivers `message.part.delta` over `/event` but NOT
`message.updated` / `message.part.updated` (SyncEvents — see #762). The Flutter
live path created the assistant `ChatMessage` bubble **only** from
`message.updated`, so delta-streamed text landed in `_chatPartsByMessage` with no
bubble to render under. Reselect worked because it REST-refetches from the DB.

## Fix

`AgentsController._ensureLiveAssistantMessage(sessionId, messageId)` — called in
the `message.part.delta` and `message.part.updated` WS handlers — synthesizes the
assistant bubble from the first live part when none exists. Safe because part
events during a turn always belong to the assistant message; the user message is
inserted optimistically (role 'user') and is never the target of an
unknown-message part event.

## Evidence chain (how the layer was isolated)

- Live WS capture (`ws://localhost:4001/ws/agents`, real turn): `message.part.delta`
  broadcast; `message.updated` / `message.part.updated` **never** broadcast.
- Raw engine `/event` capture (`:4096`): same — only `message.part.delta` present;
  `message.updated` / `message.part.updated` absent (→ #762).
- DB: messages persisted with text but NULL `tokens_json` / `cost` /
  `sdk_message_id` (those come from `message.updated.info`, which never arrives).
- Bridge reverse-lookup HIT (persist guarded on `localSessionId`) → NOT a #758
  map-miss; the api_server did its job.

## Files changed

- `apps/desktop_flutter/lib/features/agents/controllers/agents_controller.dart`
  — add `_ensureLiveAssistantMessage`; call it in the two part handlers.
- `apps/desktop_flutter/test/features/agents/issue_761_live_render_test.dart`
  — regression: delta-only and part.updated-only streaming both synthesize the
  bubble (verified failing on the unmodified controller).

## Checks run

- `dart format --set-exit-if-changed` — PASS
- `flutter analyze --no-fatal-infos` — PASS (No issues found)
- `flutter test test/features/agents/` — **445 pass / 0 fail** (with
  `RHYTHM_LOCAL_SMOKE` unset; 6 `agent_trigger_watcher` failures were
  pre-existing env-driven, confirmed on the clean tree)
- Regression test verified failing without the fix.

## Notes / follow-ups

- **#762** filed: fork `/event` drops `message.updated` & `message.part.updated`
  (SyncEvents). Until fixed, live **token/cost/model-backfill** still rely on a
  REST refetch on reselect; this #761 fix only restores live **text**.
- Combined smoke app built: `/Applications/Rhythm-fix-smoke.app` = #759 fork
  engine binary + #761 Flutter build + api_server (from main). Developer-ID
  signed, arm64, quarantine cleared.
- This run involved a long systematic-debugging pass (WS sniff + raw /event
  capture + DB inspection) rather than a verification-gate repair loop.
