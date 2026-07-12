---
date: 2026-07-11
repo: Rhythm
branch: ocu-32-writer-permission-keys
status: ready-for-coding
issues: [1073]
order: 32
depends_on: []
tags: [issue, Rhythm, opencode-utilization, m6-platform]
---

# OCU-32 — Agent writer — full permission-key round-trip

## Summary
The engine's per-agent permission block supports ~17 keys (read, edit, glob, grep, list, bash, task, external_directory, todowrite, question, webfetch, websearch, repo_clone, repo_overview, lsp, doom_loop, skill, plus custom) with wildcard patterns and ask|allow|deny values, last-match-wins. opencode_agent_writer.ts manages only edit/bash/webfetch + the manager task roster, and agent_profile_sync.ts doesn't round-trip other keys into agent_configs. Backend groundwork for a full permission matrix UI (OCU-33).

## Scope (in)
- Extend the AgentConfig model + agent_configs schema with a permissionsJson map (migrations.ts, local SQLite)
- Writer serializes arbitrary permission keys (string or pattern-map values) into .md frontmatter, preserving unmanaged keys as today and keeping the existing edit/bash/webfetch + task-roster semantics as defaults when unset
- Profile sync reads the engine's resolved agent permission blocks back into agent_configs
- REST: agent_configs routes accept/return the new map
- Validation: known keys + ask/allow/deny (+ pattern maps for bash/external_directory-style keys)

## Non-goals (out)
- No Flutter UI (OCU-33)
- No per-session permission PATCH (separate surface)
- No change to permission-mode picker semantics

## Likely files
- apps/api_server/src/services/opencode_agent_writer.ts
- apps/api_server/src/services/agent_profile_sync.ts
- apps/api_server/src/repositories/agent_configs_repository.ts
- apps/api_server/src/controllers/agent_configs_controller.ts
- apps/api_server/src/database/migrations.ts

## Acceptance criteria
- Setting {websearch: deny, external_directory: ask} on a profile via REST lands in the .md frontmatter, survives reloadConfig, and the engine enforces it (live: agent's websearch attempt is denied)
- Unmanaged frontmatter still preserved
- Existing profiles unaffected until edited
- Sync round-trip is lossless

## Required tests
- Writer serialization tests (keys, pattern maps, preserve-unmanaged)
- Sync round-trip test
- Repository migration test

## Dependencies
None
