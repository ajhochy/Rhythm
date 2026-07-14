---
date: 2026-07-11
repo: Rhythm
branch: ocu-04-session-status-resync
status: ready-for-coding
issues: [1045]
order: 04
depends_on: []
tags: [issue, Rhythm, opencode-utilization, m1-interaction-polish]
---

# OCU-04 — Session status resync via GET /session/status on engine ready

## Summary

Session status is tracked only from live events into the DB; missed events (engine restart, api_server restart, stream gap) leave rows stuck 'working'/'starting'. The engine exposes GET /session/status returning the status map for all sessions. This issue reconciles local state with the engine's authoritative status on engine ready and stream-bridge resubscribe.

## Scope (in)

- Add getSessionStatuses() wrapper (GET /session/status)
- On engine ready (ensureReady success after initialize/reloadCredentials) and on stream-bridge resubscribe, reconcile: any local DB session marked working/starting whose engine status is idle (or which the engine doesn't know) gets its status corrected
- Respect existing error-state precedence rules in the bridge
- Broadcast corrected statuses over WS

## Non-goals (out)

- No changes to per-event status handling
- No UI changes
- No changes to production user data; local agent-server (port 4001) surface only unless the spec says otherwise

## Likely files

- apps/api_server/src/services/opencode_client_service.ts
- apps/api_server/src/services/opencode_stream_bridge.ts
- apps/api_server/src/server.ts
- apps/api_server/src/repositories/agent_sessions_repository.ts

## Acceptance criteria

- Seed a DB row status='working' with no engine counterpart → after engine ready, row is idle/ended and a WS frame announces it
- Rows with status='error' are NOT clobbered
- Live restart scenario verified once manually

## Required tests

- Reconciliation unit test covering working→idle correction, error-precedence, unknown-session handling

## Dependencies

None
