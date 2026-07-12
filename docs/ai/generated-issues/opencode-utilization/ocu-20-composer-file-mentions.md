---
date: 2026-07-11
repo: Rhythm
branch: ocu-20-composer-file-mentions
status: ready-for-coding
issues: [1061]
order: 20
depends_on: [OCU-19]
tags: [issue, Rhythm, opencode-utilization, m5-files-vcs]
---

# OCU-20 — Composer @-mention file attach

## Summary
Typing @ in the composer offers fuzzy file search over the session's project dir (find-files proxy from OCU-19) and attaches the picked file. Reuses the existing attachment pipeline (agents_view.dart:1923 — image/pdf → file part, text/code → inlined text part capped 100 KB) and pending chips (_AttachmentChipWidget). Mirrors the slash popover interaction pattern (_slash_command_popover.dart).

## Scope (in)
- @-trigger popover in _InputArea with debounced find-files typeahead (session dir scoped)
- Selection attaches via the existing classification path
- Fetch content through the new content proxy instead of local file IO (critical for worktree support)
- Chip + removal identical to manual attachments
- Keyboard navigation parity with slash popover
- Escape/backspace dismisses cleanly

## Non-goals (out)
- No text-search (@-mention is file-name only; /find text search is not in this issue)
- No inline file preview (OCU-21)
- Local agent-server (port 4001) surface only; no production API changes

## Likely files
- apps/desktop_flutter/lib/features/agents/views/agents_view.dart
- apps/desktop_flutter/lib/features/agents/data/agents_data_source.dart
- apps/desktop_flutter/lib/features/agents/controllers/agents_controller.dart
- reference: apps/desktop_flutter/lib/features/agents/views/_slash_command_popover.dart

## Acceptance criteria
- @prefix shows matching files within 300ms of pause
- Pick → chip appears with file name
- Send → agent receives the file (verify it can quote its content in next turn)
- >100KB text follows the existing cap behavior
- Escape/backspace dismisses cleanly
- flutter analyze clean

## Required tests
- Widget test for trigger/typeahead/selection (mocked data source)
- Controller test for attach-from-remote-content path

## Dependencies
OCU-19
