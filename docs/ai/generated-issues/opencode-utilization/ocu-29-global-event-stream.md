---
date: 2026-07-11
repo: Rhythm
branch: ocu-29-global-event-stream
status: ready-for-coding
issues: [1070]
order: 29
depends_on: []
tags: [issue, Rhythm, opencode-utilization, m6-platform]
---

# OCU-29 — Consolidate SSE onto /global/event with heartbeat watchdog

## Summary
The stream bridge subscribes per-directory via GET /event; multiple project dirs mean multiple long-lived SSE streams, and this area has a history of subtle bugs (dual-bus split, missed question events). GET /global/event is a single stream spanning all instances with envelope {directory, project?, workspace?, payload:{id,type,properties}}, and all SSE streams emit a synthetic server.heartbeat every 10s — an idle-liveness signal the bridge currently ignores.

## Scope (in)
- Switch OpencodeStreamBridge to one /global/event subscription
- Adapt the envelope (unwrap payload, route by directory + opencodeSessionMap)
- Heartbeat watchdog: if no event (incl. heartbeat) for >30s, tear down and resubscribe + trigger the OCU-03/OCU-04 rehydration path if present (soft dependency, note it)
- Preserve all existing per-event semantics and ordering guarantees
- Keep a fallback env flag to revert to per-directory streams for one release

## Non-goals (out)
- No event-handling logic changes beyond routing
- No engine changes

## Likely files
- apps/api_server/src/services/opencode_stream_bridge.ts
- apps/api_server/src/services/opencode_client_service.ts (subscribe wrapper + global variant)

## Acceptance criteria
- All existing stream-bridge tests pass against the new envelope
- Two sessions in different directories both stream correctly over the single connection (live-verify)
- Killing the engine's stream mid-turn triggers watchdog resubscribe within 45s with no zombie "working" sessions
- Fallback flag restores old behavior

## Required tests
- Envelope-adapter unit tests
- Watchdog timer test (fake timers)
- Multi-directory routing test

## Dependencies
None
