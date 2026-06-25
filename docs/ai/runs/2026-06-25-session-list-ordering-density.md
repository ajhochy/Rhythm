---
date: 2026-06-25
repo: Rhythm
branch: feature/agent-scheduler
pr: 734
issues: []
status: implemented (UI), verified (analyze + widget tests); manual smoke pending
tags: [run, rhythm]
---

# Session-list ordering + density (and create→"vanish" misdiagnosis)

## Context

The Jun 24 smoke logged a BLOCKING regression: "the backend closes every new agent
session ~1s after a successful create" (`POST /agent-sessions` → 201 `starting`, then
`session.updated{status:closed}`). Assigned root cause was a server-side async close
(scheduler/runner reconcile or opencode-driven end).

## Investigation — the backend does NOT auto-close sessions

Reproduced against the live `:4001` server (same long-running process from the smoke):

- 6 programmatic creates (agent-less, `build` ×2, `claude-code` ×2, incl. a 3-at-once
  burst) — all stayed `starting`, none closed, over 15–25 s windows.
- A real app "+ New" click — session `d83a89b5` stayed `starting` (WS trace + DB).
- DB has `starting` sessions surviving up to **186 h**.

Static proof: `status='closed'` is only written by `markClosed`, callable only from
`agent_sessions_controller.ts:421/438` (both **throw 400** → never on a 201 path) and
`:737` = `DELETE /agent-sessions/:id` (`remove`). The scheduler (`agentSchedulerService`),
`agent_runner`, `agent_delegation_service`, and `opencode_stream_bridge` never write
`closed`; the server never emits a `session.closed` WS frame (the `agent.session_closed`
appEvent feeds only the legacy SSE route, not the WS gateway).

The smoke-era `closed` rows were **selective** (siblings created seconds apart survived),
i.e. a transient create+DELETE actor during that smoke run — not a reconcile.

**Real cause:** `createSession` appended new rows to the **bottom** of the list and the
`SessionRow` cards were tall, so a freshly created session was off-screen / easy to miss.
User confirmed: the row was at the bottom, not actually gone.

## Fix (Flutter UI only — no server changes)

- `lib/features/agents/views/_agents_nav_column.dart` — sort the displayed session list
  by `createdAt` descending (newest first) into a copy (`controller.sessions` is
  unmodifiable). New session lands at the top and is already auto-selected by
  `_instantCreateSession`.
- `lib/features/agents/views/_session_list_body.dart` — `SessionRow` is now a compact
  single line (badge · name · status dot · ⋯ menu); padding 12 → 10/7, preview 11 → 10.5,
  inter-row gap 6 → 4. Roughly halves card height so many more sessions are visible.

## Checks

- `dart format` — clean.
- `flutter analyze --no-fatal-infos` (changed files) — No issues found.
- `flutter test` — `opc_713_create_loading`, `opc_instant_new_session`,
  `agents_nav_column_mounted` (incl. rich-SessionRow + short-surface-no-overflow),
  `issue_645_agent_pill_stale_icon` — all pass.

## Notes / still open

- Smoke doc corrected (`smoke-test.md`): the create→"vanish" entry is now marked
  RESOLVED (misdiagnosis) with the corrected analysis.
- Still open (separate, out of scope here): delegated sessions complete server-side but
  the desktop card stays "Starting" with no model/usage — delegated runs execute
  synchronously inside `POST /agent-delegation/delegate` and never stream lifecycle/usage
  over the agent WebSocket.
