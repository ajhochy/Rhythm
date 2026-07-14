---
date: 2026-07-11
repo: Rhythm
branch: ocu-17-session-worktree-option
status: ready-for-coding
issues: [1058]
order: 17
depends_on: [OCU-16]
tags: [issue, Rhythm, opencode-utilization, m4-worktrees]
---

# OCU-17 — Session create with isolateWorktree option

## Summary
With worktree APIs exposed (OCU-16), session creation can offer isolation: create a worktree first, then create the engine session with the worktree path as its directory/cwd, so agent edits land in the isolated checkout instead of the main one. This fixes the known parallel-agent conflict on shared checkouts. Session rows remember their worktree for later UI actions and cleanup.

## Scope (in)
- POST /agent-sessions accepts isolateWorktree?: boolean (+ optional worktreeName)
- When isolateWorktree is set, create worktree first (await ready or synchronous create result), then createSession with the worktree dir as cwd
- Persist worktree name, path, and branch on the session row
- Database migration in migrations.ts to add worktree fields to agent_sessions table (verify postgres_bootstrap.ts is NOT needed — agent sessions are local-SQLite only)
- Expose worktree info in session GET payloads
- On hard delete of a session with a worktree, optionally remove the worktree (explicit flag from caller, default keep)
- Background agent runs (AgentRunner) also support the same isolateWorktree option

## Non-goals (out)
- No Flutter UI (OCU-18)
- No auto-PR/merge-back flow from worktree to main checkout (follow-up material)
- No multi-session shared worktrees
- Local agent-server (port 4001) surface only; no production API changes

## Likely files
- apps/api_server/src/controllers/agent_sessions_controller.ts
- apps/api_server/src/repositories/agent_sessions_repository.ts
- apps/api_server/src/database/migrations.ts
- apps/api_server/src/services/agent_runner.ts

## Acceptance criteria
- Creating a session with isolateWorktree=true → agent file edits land in the worktree dir, main checkout untouched (live-verify with a real edit)
- Session payload carries worktree metadata (name, path, branch)
- Delete with removeWorktree=true cleans up dir and branch
- Sessions without the flag behave exactly as today
- Migration applies cleanly on fresh installs and existing databases

## Required tests
- Controller tests for isolateWorktree on/off, metadata persistence, delete cleanup flag
- Repository migration test

## Dependencies
OCU-16
