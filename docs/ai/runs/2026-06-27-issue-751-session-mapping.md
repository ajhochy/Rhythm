---
date: 2026-06-27
repo: Rhythm
branch: fix/issue-751-session-mapping
pr: TBD
issues: [751]
status: verified-pending-merge
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# Issue #751 — Agent session stuck on "Starting" (event reverse-lookup miss)

## Symptom
Agent sessions sat on the "Starting" badge with no messages, token counts, or
Task chips, and delegated child/subagent sessions never appeared — even though
the opencode engine ran the whole turn (parent + subagents) to completion.

## Root cause
`OpencodeStreamBridge._relayEvent` resolved the local session **only** by
reverse-looking-up the event's SDK session id in the in-memory
`opencodeSessionMap` (`opencode_stream_bridge.ts` ~278-286). That map is
ephemeral — wiped on every api_server restart and not guaranteed populated at
the instant a freshly-created session's first events arrive. When it missed,
**every** event for the session was dropped: status never left the `starting`
DB default, message parts never persisted, and child `session.created` events
had no parent to attach to. The durable `agent_sessions.sdk_session_id` column
(set at create/resume time) was never consulted as a fallback.

## Fix
- `AgentSessionsRepository.findBySdkSessionId(sdkId)` — durable lookup by the
  persisted SDK session id.
- `_relayEvent` now falls back to that lookup when the in-memory reverse-lookup
  misses, and **lazily repopulates** `opencodeSessionMap` so subsequent events
  take the fast path. The map-hit path is byte-for-byte unchanged.

Strictly additive: the fallback only runs when the existing lookup misses.
GitNexus impact: `_relayEvent` is HIGH-fan-in (create/resume/fork) but the
change preserves the hit-path; `detect_changes` vs `main` = low risk, scoped to
the 3 expected symbols.

## Files changed
- `apps/api_server/src/services/opencode_stream_bridge.ts`
- `apps/api_server/src/repositories/agent_sessions_repository.ts`
- `apps/api_server/src/__tests__/issue_751_session_mapping.test.ts` (new)

## Checks run
- `issue_751_session_mapping.test.ts` — RED on unfixed code (status stuck at
  `starting`, 0 messages, map not repopulated), GREEN after fix (6/6).
- `ai-workflow checks --level issue` and `--level pr` — PASS (flutter analyze,
  dart format, api_server tsc, api_server vitest 1279).
- GitNexus `detect_changes` vs `main` — low risk.

## Live-engine verification (instrumented dev run)
- User approved quitting the app for an instrumented dev api_server (own fresh
  engine). A delegating turn ("spawn a @general subagent…") was driven through
  the real WS gateway with temporary `[INSTR-751]` logging (since removed).
- The **in-process bridge received 134 events** (message.part.delta, .updated,
  session.status, session.idle, session.created…). Parent → `idle` with 3
  messages; **child row created and linked** (`parent_session_id` = parent),
  named for the @general subagent. 112 events resolved via the map, 3 benign
  `MISS` (background curator/memory sessions with no DB row).

## Notes / investigation deviation
- An intermediate finding suggested "the engine emits no SSE events" because
  **external attach probes** (`createOpencodeClient({baseUrl})` and raw `curl`
  on `/event`) received only `server.connected`. This was a probe artifact:
  opencode delivers session events to the **in-process / engine-spawning**
  subscriber, not foreign attach clients. The instrumented dev run corrected
  this — the real bridge receives the full event stream. The map-miss diagnosis
  in the issue stands; the fix is the durable DB fallback.
- The two pre-existing stuck rows (`0a4ea2e7`, `b89c8b7f`) won't retroactively
  recover their already-completed turns; a new prompt (auto-resume) or the fix
  applied to future turns is the path forward. The fix prevents recurrence.
