---
date: 2026-07-11
repo: Rhythm
branch: ocu-11-slash-popover-args
status: ready-for-coding
issues: [1052]
order: 11
depends_on: [OCU-09]
tags: [issue, Rhythm, opencode-utilization, m2-playbooks]
---

# OCU-11 — Slash popover — argument hints + custom-command dispatch verification

## Summary

The slash popover already lists engine commands and dispatches via the WebSocket input path; engine executes via POST /session/:id/command and emits command.executed. Custom commands take arguments ($ARGUMENTS/$1..$n) — the popover should hint them, and custom-command dispatch + transcript rendering needs verification for commands with agent/model overrides and subtask:true.

## Scope (in)

- Show each command's argument hint (engine command.list returns hints) as ghost text after selection
- Ensure typed arguments are passed through the existing dispatch path
- Verify + fix transcript rendering of custom command invocations incl. subtask runs (subtask spawns a child session — TaskChip should appear as for task tool)
- Refresh popover catalog when playbooks change (listen or refetch on open)

## Non-goals (out)

- No new dispatch transport (reuse existing WS path; the unused HTTP dispatchCommand data-source method is being removed in OCU-34)
- No popover redesign
- No changes to production user data beyond what the spec names

## Likely files

- apps/desktop_flutter/lib/features/agents/views/_slash_command_popover.dart
- apps/desktop_flutter/lib/features/agents/data/commands_data_source.dart
- apps/desktop_flutter/lib/features/agents/views/agents_view.dart (_CommandInvocationRow wiring)

## Acceptance criteria

- /my-playbook some args runs with args substituted (verify in transcript output)
- Argument hint shown for commands that declare one
- A subtask:true command renders a child-session chip that opens the child transcript
- Popover reflects a just-created playbook without app restart

## Required tests

- Widget test for hint rendering + arg passthrough payload
- Manual smoke item for subtask child-session chip

## Dependencies

OCU-09
