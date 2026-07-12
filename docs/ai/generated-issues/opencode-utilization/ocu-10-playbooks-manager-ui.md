---
date: 2026-07-11
repo: Rhythm
branch: ocu-10-playbooks-manager-ui
status: ready-for-coding
issues: [1051]
order: 10
depends_on: [OCU-09]
tags: [issue, Rhythm, opencode-utilization, m2-playbooks]
---

# OCU-10 — Playbooks manager UI (create/edit/delete custom commands)

## Summary

Product face of custom commands called "Playbooks" — saved, parameterized prompts staff run from the slash popover (e.g. "Draft weekly bulletin"). Mirrors the existing Skills manager UI with the same interaction patterns as agent_skills and ManagedSkillEditorSheet.

## Scope (in)

- New feature dir features/agent_playbooks (view + controller + data source hitting /opencode/commands)
- TOOLS rail entry "Playbooks" in _agents_nav_column.dart (launcher list around lines 776-924)
- List shows name, description, source badge (Rhythm-managed / built-in / MCP), managed rows get edit/delete
- Editor sheet: name, description, template body with $ARGUMENTS helper text, optional agent picker (from existing profiles list), optional model picker (existing catalog source), subtask toggle
- Built-ins read-only

## Non-goals (out)

- No command execution from the manager (that's the slash popover, OCU-11)
- No template linting beyond non-empty
- No changes to production user data beyond what the spec names

## Likely files

- apps/desktop_flutter/lib/features/agent_playbooks/ (new: views/agent_playbooks_view.dart, controllers/agent_playbooks_controller.dart, data/agent_playbooks_data_source.dart)
- apps/desktop_flutter/lib/features/agents/views/_agents_nav_column.dart
- apps/desktop_flutter/lib/main.dart (provider wiring)

## Acceptance criteria

- Create a playbook in the UI → it appears in the slash popover of a session immediately
- Edit round-trips body + options
- Delete removes it
- Built-in commands visible but not editable
- Flutter analyze + dart format clean

## Required tests

- Widget test pumping the mounted playbooks view (list/create/edit paths, mocked data source)
- Controller unit tests

## Dependencies

OCU-09
