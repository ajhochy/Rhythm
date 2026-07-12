---
date: 2026-07-11
repo: Rhythm
branch: ocu-19-file-find-proxy
status: ready-for-coding
issues: [1060]
order: 19
depends_on: []
tags: [issue, Rhythm, opencode-utilization, m5-files-vcs]
---

# OCU-19 — Proxy engine find/file endpoints

## Summary
The engine's file/search APIs are completely unused: GET /find (ripgrep text search, capped 10 results), GET /find/file (fuzzy file/dir search with limit 1-200 and filters), GET /file (list directory), GET /file/content (read file), and GET /file/status (git-aware file status). These power composer @-mentions (OCU-20) and a Files tab (OCU-21). Wrap all of them and expose through the API server.

## Scope (in)
- opencode_client_service wrappers: findText(), findFiles(), listFiles(), readFileContent(), fileStatus() — all taking the session's directory
- New Express router /agent-sessions/:id/files with subroutes find-text, find-files, list, content, status
- Resolve the session's cwd/worktree dir and pass it as the engine directory param
- Path-traversal guard: reject paths resolving outside the session directory (400 response)
- Size guard on content responses: reuse engine behavior, cap relayed payload ~2MB

## Non-goals (out)
- No write/upload endpoints
- No Flutter UI (OCU-20/21)
- No indexing/caching layer
- Local agent-server (port 4001) surface only; no production API changes

## Likely files
- apps/api_server/src/services/opencode_client_service.ts
- apps/api_server/src/routes/agent_sessions_routes.ts (or new agent_session_files_routes.ts registered in app.ts)
- apps/api_server/src/controllers/agent_sessions_controller.ts

## Acceptance criteria
- Each subroute round-trips against a live engine for a real session dir
- Requests for paths outside the session dir return 400
- Binary files come back flagged/base64 per engine semantics
- Unknown session returns 404
- Directory param is properly resolved from worktree (if set) or base session dir

## Required tests
- Route contract tests (mocked engine) including path-traversal guard
- One live smoke test listing this repo's own dir documented in verification notes

## Dependencies
None
