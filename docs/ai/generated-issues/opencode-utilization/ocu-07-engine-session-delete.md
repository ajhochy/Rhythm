---
date: 2026-07-11
repo: Rhythm
branch: ocu-07-engine-session-delete
status: ready-for-coding
issues: [1048]
order: 07
depends_on: []
tags: [issue, Rhythm, opencode-utilization, m1-interaction-polish]
---

# OCU-07 — Delete engine sessions on hard delete (stop storage leak)

## Summary

DELETE /agent-sessions/:id and /:id/hard remove the local DB row and stop the stream but never call the engine's DELETE /session/:sessionID. Engine-side messages, parts, and snapshots accumulate forever on every machine. Engine delete is recursive over child sessions. This issue integrates the engine delete call into the hard-delete flow.

## Scope (in)

- Add deleteSession wrapper (SDK session.delete is declared at @types d.ts:533, currently unused)
- Call it on hard delete (and on soft delete iff the product intent is full removal — follow existing destroy() semantics in agent_sessions_controller.ts)
- Tolerate 404 (already gone)
- Leave archived sessions untouched

## Non-goals (out)

- No bulk retro-cleanup of historical orphans (file follow-up if wanted)
- No UI changes
- No changes to production user data; local agent-server (port 4001) surface only unless the spec says otherwise

## Likely files

- apps/api_server/src/services/opencode_client_service.ts
- apps/api_server/src/controllers/agent_sessions_controller.ts

## Acceptance criteria

- Hard-deleting a session removes it engine-side (GET /session/:id → 404 live) including children
- Delete of a session whose engine record is already gone still succeeds
- Soft-delete/archive behavior unchanged

## Required tests

- Controller test asserting engine delete called on destroy and 404 tolerated
- Child-session recursion covered by asserting single engine call (engine recurses)

## Dependencies

None
