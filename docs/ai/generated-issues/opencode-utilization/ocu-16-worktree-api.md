---
date: 2026-07-11
repo: Rhythm
branch: ocu-16-worktree-api
status: ready-for-coding
issues: [1057]
order: 16
depends_on: []
tags: [issue, Rhythm, opencode-utilization, m4-worktrees]
---

# OCU-16 — Worktree API wrappers + routes + ready/failed event relay

## Summary
Foundation for isolated agent sessions: expose engine worktree lifecycle to the local REST surface. The opencode engine offers GET /experimental/worktree (list), POST (create with optional name and startCommand), DELETE (remove — forced, deletes branch), and POST /experimental/worktree/reset (reset to primary default branch). Events worktree.ready and worktree.failed arrive on the SSE stream and must be relayed as first-class WS frames to the Flutter client.

## Scope (in)
- opencode_client_service wrappers: listWorktrees(), createWorktree(name?, startCommand?), removeWorktree(name), resetWorktree() (direct fetch OK until typed SDK lands)
- New Express router /opencode/worktrees with GET (list), POST (create), DELETE (remove), and POST /reset
- All routes take project directory param from session context
- Explicit stream-bridge handling for worktree.ready and worktree.failed events → broadcast as typed WS frames (not generic relay)

## Non-goals (out)
- No session-creation integration (OCU-17)
- No Flutter UI (OCU-18)
- Local agent-server (port 4001) surface only; no production API changes

## Likely files
- apps/api_server/src/services/opencode_client_service.ts
- apps/api_server/src/routes/opencode_worktrees_routes.ts (new)
- apps/api_server/src/app.ts
- apps/api_server/src/services/opencode_stream_bridge.ts

## Acceptance criteria
- POST /opencode/worktrees creates a real git worktree (verify dir + branch exist) and the ready event surfaces as a typed WS frame
- GET /opencode/worktrees list returns created worktrees
- POST /opencode/worktrees/reset and DELETE /opencode/worktrees/:name work against a real repo
- Failure (non-git dir) surfaces worktree.failed cleanly

## Required tests
- Route contract tests with mocked engine
- One live-behavior test against a temp git repo documented in verification notes

## Dependencies
None
