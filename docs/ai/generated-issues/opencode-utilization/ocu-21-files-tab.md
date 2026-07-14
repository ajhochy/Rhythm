---
date: 2026-07-11
repo: Rhythm
branch: ocu-21-files-tab
status: ready-for-coding
issues: [1062]
order: 21
depends_on: [OCU-19]
tags: [issue, Rhythm, opencode-utilization, m5-files-vcs]
---

# OCU-21 — Inspector Files tab (browse + preview)

## Summary
The inspector rail (tabs including Terminal, Changes, Context in agents_view.dart / _session_side_panel.dart) gains a Files tab: tree/list browsing of the session's project directory with git-status dots and read-only preview (text/images/binary stubs), matching how the Changes tab presents diffs.

## Scope (in)
- New _files_tab.dart: directory list view rooted at session dir (lazy expand via list proxy)
- Status indicators from file/status endpoint (git-aware: modified, untracked, staged, etc.)
- Tap → preview pane: text with monospace rendering, images inline, binary files → "binary file" stub
- Refresh action
- Wire into the inspector tab bar alongside existing tabs
- Support worktree-isolated sessions (roots at worktree dir)

## Non-goals (out)
- No editing, renaming, or file operations
- No watcher-driven live refresh (manual refresh only — file.watcher events are a possible follow-up)
- Local agent-server (port 4001) surface only; no production API changes

## Likely files
- apps/desktop_flutter/lib/features/agents/views/_files_tab.dart (new)
- apps/desktop_flutter/lib/features/agents/views/_session_side_panel.dart
- apps/desktop_flutter/lib/features/agents/controllers/agents_controller.dart
- apps/desktop_flutter/lib/features/agents/data/agents_data_source.dart

## Acceptance criteria
- Browse into nested dirs of a real session
- Modified files show status dots
- Preview renders text and images
- Refuses >2MB gracefully with a message
- Works for worktree-isolated sessions (roots at worktree dir)
- flutter analyze clean

## Required tests
- Widget test pumping the mounted tab with mocked tree fixtures (expand/preview/status)

## Dependencies
OCU-19
