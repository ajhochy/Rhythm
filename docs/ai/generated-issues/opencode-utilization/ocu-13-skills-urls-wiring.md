---
date: 2026-07-11
repo: Rhythm
branch: ocu-13-skills-urls-wiring
status: ready-for-coding
issues: [1054]
order: 13
depends_on: [OCU-12]
tags: [issue, Rhythm, opencode-utilization, m3-org-skill-library]
---

# OCU-13 — Wire engine skills.urls to the org skill index

## Summary

With OCU-12 serving an engine-compatible index, the local api_server points the engine at it via the `skills` config key (skills.urls array) in the managed ~/.config/opencode/opencode.json — same managed-key pattern as the mcp/plugin keys. URL derives from the user's configured production server URL.

## Scope (in)

- New ensureOrgSkillIndex() managed-config step: set skills.urls to [<prodBase>/org-skills/index.json] preserving any user-added entries
- Run at engine init and when the production server URL changes
- Call reloadSkills after set
- Handle offline gracefully (engine caches — verify no startup failure when prod unreachable, log-and-continue)

## Non-goals (out)

- No UI (OCU-14)
- No publish flow (OCU-15)
- Do not touch skills.paths (local managed dir stays the sole local source per #947)
- No changes to production user data beyond what the spec names

## Likely files

- apps/api_server/src/services/opencode_client_service.ts
- apps/api_server/src/services/opencode_plugin_config.ts (or sibling managed-config module if cleaner)
- apps/api_server/src/server.ts

## Acceptance criteria

- After engine start with prod reachable, GET /skill on the engine lists org skills alongside local ones
- User-added skills.urls entries survive
- Prod unreachable → engine starts normally, warning logged
- Changing server URL updates the entry

## Required tests

- Managed-config unit tests (set/preserve/update URL)
- Mocked-offline start test

## Dependencies

OCU-12
