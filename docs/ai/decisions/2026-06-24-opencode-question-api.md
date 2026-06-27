---
date: 2026-06-24
repo: Rhythm
tags: [decision, Rhythm]
index: "[[Rhythm]]"
---

# Answer agent "ask question" via opencode's Question API, not session.input

## Context
The `question` (AskUserQuestion) tool hung every agent session. The original
`QuestionToolCard` (#622/#630) assumed the answer could be sent back as a plain
`session.input` prompt and its own test note even admitted "opencode SDK does
not emit 'question' tool events on this build" — the mechanism was never verified.

Investigation against the running opencode 1.14.x binary (route table + event
definitions) and the live `GET /question` payload established the real contract:
opencode has a **dedicated Question API**, parallel to the permission API.

## Decision
- Treat questions like the #711 permission handshake. opencode emits
  `question.asked` (`QuestionRequest { id, sessionID, questions, tool:{callID} }`)
  and blocks the tool at `status: running` until `POST /question/{requestID}/reply`
  with `{ answers: string[][] }` (or `/reject`).
- The stream bridge captures `question.asked`, tracks the pending question
  keyed by `${localSessionId}:${requestId}`, and stores the tool `callID`.
- Flutter answers via a REST endpoint keyed by the tool **callId** it already
  rendered — `POST /agent-sessions/:id/question/:callId/:action`. The server
  resolves callId → opencode `requestId`, so the `que_…` id never leaves the
  server. (callId↔requestId correlation confirmed: the stuck tool part's
  `callID` matched the pending request's `tool.callID`.)
- Call opencode's Question routes by **direct HTTP** on the spawned server's
  `url`, because the v1 `OpencodeClient` Rhythm holds does NOT expose them — the
  Question API is only in the SDK's **v2** namespace (`@opencode-ai/sdk` 1.14.49
  `dist/v2/gen` `class Question`). `QuestionAnswer = Array<string>` → `answers`
  is `string[][]` (one selected-label list per question).

## Alternatives considered
- **Reply via `session.input`** (the original approach) — a new user turn never
  completes a pending question; the tool hangs. Rejected (this was the bug).
- **Use the SDK v2 `Question` client** — would couple us to instantiating a
  second (v2) client; the hand-written v1 shim already drives the rest of the
  integration. Direct HTTP to the confirmed route is simpler and version-robust.
- **Correlate by sessionId only** (one pending question per session) — fragile if
  a session ever has multiple pending questions. callId correlation is exact.

## Consequences
- A new `question.*` event family is handled in the bridge and a new
  `/question/:callId/:action` route exists. The hand-written
  `opencode-ai-sdk.d.ts` Event union now declares the three question events
  (same maintenance pattern as `EventPermissionAsked` — keep diffing the shim
  against the real SDK, see [[project_opencode_sdk_dts_must_match_real]]).
- A Dismiss affordance always unblocks the agent, so a question can never
  permanently stall a session.
