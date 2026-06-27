---
date: 2026-06-24
repo: Rhythm
branch: feature/agent-scheduler
pr: 734
issues: [agent-question-hang]
status: verified-local
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# Fix: agent sessions hang when an agent uses "ask question"

## Symptom
Any agent session that called the `question` (AskUserQuestion) tool hung
forever — the card showed "Waiting for question…" and the answer never reached
the agent. Reproduced with **every** model (OpenRouter + Claude Code), because
all agents run through the same opencode `build` agent (agent_runner.ts: the
agentKind is only a model selector).

## Root cause (confirmed against the running opencode 1.14.x binary + live DB)
opencode answers its `question` tool through a **dedicated Question API**, not
through `session.input` and not through the permission endpoint:
- event `question.asked` → `QuestionRequest { id, sessionID, questions, tool:{callID} }`
- `POST /question/{requestID}/reply` body `{ answers: string[][] }` (one selected-label list per question; `QuestionAnswer = string[]`)
- `POST /question/{requestID}/reject`

Rhythm never listened for `question.asked` (so never captured the requestID),
and `QuestionToolCard` answered via a plain `session.input` prompt — which never
completes the pending question. The tool stayed `status: running` forever.
Proof: `GET /question` on the live opencode showed both stuck sessions still
pending; the stuck tool part in the agent SQLite DB had `status: running`, no
`time.end`, and a `callID` that matched the pending `que_…` request's `tool.callID`.

## Fix (mirrors the #711 permission handshake)
Server (api_server):
- `opencode_stream_bridge.ts` — handle `question.asked` (track `PendingQuestion`
  by `${localSessionId}:${requestId}`, broadcast a `question.asked` WS frame with
  requestId+callId+questions) and `question.replied`/`question.rejected` (clear +
  broadcast `question.resolved`). New `getPendingQuestionByCallId`.
- `opencode_client_service.ts` — `replyToQuestion` / `rejectQuestion` /
  `listQuestions` call the spawned server's HTTP routes directly (the v1
  `OpencodeClient` Rhythm holds has no Question API — it lives in the SDK v2
  namespace). `serverUrl` getter added from the server handle.
- `agent_sessions_controller.ts` + routes — `POST /:id/question/:callId/:action`
  resolves callId → requestId (bridge map, GET /question fallback) then replies.
- `@types/opencode-ai-sdk.d.ts` — added EventQuestion{Asked,Replied,Rejected} to
  the hand-written Event union (same pattern as EventPermissionAsked).

Flutter (desktop_flutter):
- `ChatPart.toolCallId` (parsed from `raw['callID']`).
- `agent_ws_message.dart` — QuestionAsked/QuestionResolved messages.
- `agents_controller.dart` — handlers + `replyQuestion`/`rejectQuestion` +
  `questionsForCallId`/`isQuestionResolved` (authoritative-question fallback so
  the card renders even if the tool input streams in late — fixes the stuck
  "Waiting for question…" placeholder).
- `_question_tool_card.dart` — answers via `replyQuestion` (List<List<String>>),
  NOT `sendInput`; added a **Dismiss** affordance (always available, incl. the
  waiting state) → `rejectQuestion`. Controller access is null-safe so isolated
  widget tests still render.

## Files changed
18 files (5 server, 7 Flutter feature, 6 test stubs updated for the 2 new
`AgentsRepository` methods), + 2 new regression tests:
`opc_question_handshake.test.ts`, `question_reply_handshake_test.dart`.

## Checks run (verified, branch feature/agent-scheduler)
- api_server: `tsc --noEmit` clean; full vitest **1078/1078**.
- desktop_flutter: `dart format --set-exit-if-changed` 0 changed; `flutter
  analyze --no-fatal-infos` exit 0 (0 err/0 warn); `flutter test
  test/features/agents/` **418/418** (incl. new test + #630 regression).
- New tests confirmed red→green.

## Notes / follow-ups
- Visual click-through is the user's manual smoke (the card only appears when an
  agent actually calls `question`; not deterministically screenshot-able). The
  two currently-stuck live sessions can be cleared by answering once the rebuilt
  app is running (or via `POST /question/{id}/reject`).
- Changes are uncommitted on `feature/agent-scheduler` (stacked per user choice).
- Decision recorded: `docs/ai/decisions/2026-06-24-opencode-question-api.md`.
