---
date: 2026-07-11
repo: Rhythm
branch: ocu-22-branch-badge
status: ready-for-coding
issues: [1063]
order: 22
depends_on: []
tags: [issue, Rhythm, opencode-utilization, m5-files-vcs]
---

# OCU-22 — Branch badge + working-tree status in transcript header

## Summary
Agents change branches and dirty the tree invisibly. Engine: GET /vcs (returns branch and default branch), GET /vcs/status (changed files), event vcs.branch.updated {branch?}. Add a small both-sides feature: header badge showing current branch + dirty-file count per session.

## Scope (in)
- api_server: wrappers getVcs() and getVcsStatus() in opencode_client_service
- Routes under /agent-sessions/:id/vcs (GET for both getVcs and getVcsStatus)
- Explicit stream-bridge relay of vcs.branch.updated event as a typed WS frame (not generic relay)
- Flutter: badge in the transcript header (branch name + N changed tooltip listing files)
- Badge refreshed on vcs.branch.updated WS frame and on turn idle
- Hide badge when dir isn't a git repo

## Non-goals (out)
- No diff rendering changes (OCU-23)
- No branch switching UI
- Local agent-server (port 4001) surface only; no production API changes

## Likely files
- apps/api_server/src/services/opencode_client_service.ts
- apps/api_server/src/routes/agent_sessions_routes.ts
- apps/api_server/src/services/opencode_stream_bridge.ts
- apps/desktop_flutter/lib/features/agents/views/agents_view.dart
- apps/desktop_flutter/lib/features/agents/data/agents_data_source.dart

## Acceptance criteria
- Badge shows correct branch live (agent runs git checkout -b → badge updates via vcs.branch.updated event)
- Dirty count matches git status
- Non-git session shows no badge
- flutter analyze clean

## Required tests
- Bridge relay test for vcs.branch.updated event
- Widget test for badge states (clean/dirty/non-git)

## Dependencies
None
