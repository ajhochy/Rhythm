---
date: 2026-07-11
repo: Rhythm
branch: ocu-23-branch-diff-export
status: ready-for-coding
issues: [1064]
order: 23
depends_on: []
tags: [issue, Rhythm, opencode-utilization, m5-files-vcs]
---

# OCU-23 — Changes tab — branch-diff mode + raw patch export

## Summary
The Changes tab shows only the session-scoped diff (GET /session/:id/diff). The engine also offers GET /vcs/diff?mode=git|branch (structured; branch mode = full diff vs default branch — right for worktree/branch workflows) and GET /vcs/diff/raw (text/x-diff patch). Add a scope toggle and patch export to the Changes tab.

## Scope (in)
- api_server: proxy vcs/diff (with mode param) and vcs/diff/raw endpoints under /agent-sessions/:id/vcs
- Flutter Changes tab: scope toggle [This session | All uncommitted | vs default branch] mapping to session.diff / vcs/diff mode=git / mode=branch
- Render all three scopes through the existing UnifiedDiffView
- "Export patch" action saving the raw patch via file-save dialog

## Non-goals (out)
- No POST /vcs/apply (applying external patches is out — safety)
- No commit/stage UI
- Local agent-server (port 4001) surface only; no production API changes

## Likely files
- apps/api_server/src/services/opencode_client_service.ts
- apps/api_server/src/routes/agent_sessions_routes.ts
- apps/desktop_flutter/lib/features/agents/views/_changes_tab.dart
- apps/desktop_flutter/lib/features/agents/data/agents_data_source.dart

## Acceptance criteria
- All three scopes render correct diffs against a live repo state
- Export writes a valid patch (git apply --check passes on it)
- Empty-diff states are clean per scope
- flutter analyze clean

## Required tests
- Proxy contract tests (mode passthrough, raw content-type)
- Widget test for scope toggle rendering fixtures

## Dependencies
None
