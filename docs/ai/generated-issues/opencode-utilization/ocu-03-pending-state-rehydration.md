---
date: 2026-07-11
repo: Rhythm
branch: ocu-03-pending-state-rehydration
status: ready-for-coding
issues: [1044]
order: 03
depends_on: [OCU-01]
tags: [issue, Rhythm, opencode-utilization, m1-interaction-polish]
---

# OCU-03 — Rehydrate pending permissions/questions on engine (re)connect

## Summary

Pending permission and question cards live only in the stream bridge's in-memory maps. An api_server or app restart while a request is pending orphans it: the engine still waits, but no card is shown. The engine exposes GET /permission and GET /question listing all pending requests. This issue rehydrates those pending states from the engine on reconnect.

## Scope (in)

- On stream-bridge (re)subscribe, fetch GET /permission (new wrapper listPermissions) and GET /question (existing listQuestions at opencode_client_service.ts:1709)
- Map entries to local sessions via opencodeSessionMap
- Repopulate pending maps and re-broadcast permission/question card frames over the WS gateway
- Do the same when a Flutter client (re)attaches to a session (include pending cards in the session attach snapshot)

## Non-goals (out)

- No UI changes (existing cards render the re-broadcast frames)
- No question-card redesign (OCU-06)
- No changes to production user data; local agent-server (port 4001) surface only unless the spec says otherwise

## Likely files

- apps/api_server/src/services/opencode_stream_bridge.ts
- apps/api_server/src/services/opencode_client_service.ts
- apps/api_server/src/services/ws_gateway.ts

## Acceptance criteria

- Kill and restart api_server while an agent has a pending permission ask → the card reappears in the Flutter client and answering it works
- Same for a pending question
- No duplicate cards when the event stream also redelivers

## Required tests

- Contract test simulating restart (fresh bridge + stubbed GET /permission listing one pending) asserting re-broadcast + reply routing
- Dedup test (event + rehydrate for same requestID → one card)

## Dependencies

OCU-01
