---
date: 2026-07-11
repo: Rhythm
branch: ocu-18-worktree-ui
status: ready-for-coding
issues: [1059]
order: 18
depends_on: [OCU-17]
tags: [issue, Rhythm, opencode-utilization, m4-worktrees]
---

# OCU-18 — Worktree UI — create toggle, session badge, Changes-tab actions

## Summary
Client face of worktree isolation. Session creation dialog gains the toggle; session rows and the transcript header show an isolation badge; the Changes tab gains worktree actions. Users can opt into isolated worktrees at creation time and visually identify which sessions are isolated.

## Scope (in)
- "Run in isolated worktree" toggle (default off) with optional name field in _NewSessionDialog (apps/desktop_flutter/lib/features/agents/views/agents_view.dart:2525)
- Pass toggle and name through controller and data source to the new create option
- Worktree badge (icon + tooltip with path/branch) on session rows (_session_list_body.dart) and header for isolated sessions
- Changes tab (_changes_tab.dart): Reset worktree and Remove worktree actions with confirm dialogs
- Remove action only available for ended sessions
- Toast on worktree.ready and worktree.failed WS frames
- Wire controller to listen for and display worktree events

## Non-goals (out)
- No worktree browser/diff-vs-main view (branch diff arrives with OCU-23)
- No auto-merge-back UI
- Local agent-server (port 4001) surface only; no production API changes

## Likely files
- apps/desktop_flutter/lib/features/agents/views/agents_view.dart
- apps/desktop_flutter/lib/features/agents/views/_session_list_body.dart
- apps/desktop_flutter/lib/features/agents/views/_changes_tab.dart
- apps/desktop_flutter/lib/features/agents/controllers/agents_controller.dart
- apps/desktop_flutter/lib/features/agents/data/agents_data_source.dart

## Acceptance criteria
- Toggle produces an isolated session whose badge shows the worktree branch
- Reset and Remove actions work with confirmation and update state
- Non-isolated sessions show no badge
- Worktree event toasts appear cleanly
- flutter analyze and dart format pass

## Required tests
- Widget tests on the mounted dialog (toggle → create payload) and Changes-tab actions (mocked data source)
- Controller unit tests for event handling

## Dependencies
OCU-17
