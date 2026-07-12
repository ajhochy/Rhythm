---
date: 2026-07-11
repo: Rhythm
branch: ocu-33-permission-matrix-ui
status: ready-for-coding
issues: [1074]
order: 33
depends_on: [OCU-32]
tags: [issue, Rhythm, opencode-utilization, m6-platform]
---

# OCU-33 — Profile sheet — per-agent native-tool permission matrix

## Summary
The agent profile sheet (apps/desktop_flutter/lib/features/agents/views/_agent_profile_sheet.dart) has MCP and Skills allowlists but no native-tool permissions. With OCU-32's backend, add the third section: a permission matrix over the engine's permission keys.

## Scope (in)
- New "Tool Permissions" section in AgentProfileSheet: rows per known key (read, edit, bash, webfetch, websearch, task, external_directory, question, todowrite, skill, glob, grep, list — hide exotic keys behind "Advanced")
- Tri-state control Ask/Allow/Deny with "engine default" as unset state
- Bash row supports simple pattern entries (add pattern → ask/allow/deny)
- Load/save through agent_configs data source
- Visual consistency with existing allowlist sections incl. deny-all-style banners when everything is denied

## Non-goals (out)
- No per-session permission editing
- No custom-key authoring UI (Advanced shows only keys already present)

## Likely files
- apps/desktop_flutter/lib/features/agents/views/_agent_profile_sheet.dart
- apps/desktop_flutter/lib/features/agent_configs/ (models/controller/data source)

## Acceptance criteria
- Set websearch=Deny on a profile in the sheet → engine denies that agent's websearch (live-verify)
- Unset rows leave frontmatter untouched
- Bash pattern add/edit/remove round-trips
- Sheet remains usable (section collapsed by default)
- flutter analyze + dart format clean

## Required tests
- Widget test on the mounted sheet section (tri-state changes → save payload; pattern rows)
- Controller unit tests

## Dependencies
OCU-32
