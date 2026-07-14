---
date: 2026-07-11
repo: Rhythm
branch: ocu-30-managed-config-keys
status: ready-for-coding
issues: [1071]
order: 30
depends_on: []
tags: [issue, Rhythm, opencode-utilization, m6-platform]
---

# OCU-30 — Managed config adoption — small_model, username, reference, compaction/tool_output defaults

## Summary
Rhythm manages only plugin/mcp/$schema in ~/.config/opencode/opencode.json. Cheap wins the engine already supports: small_model routes title/summary/compaction-title work to a cheap model (direct cost savings — currently these burn the session's main model); username sets the display name in conversations; reference registers named local/git refs addressable as @alias/path in prompts (e.g. the Obsidian vault, docs dirs); compaction + tool_output accept sane cap tuning.

## Scope (in)
- Extend the managed-config writer (same preserve-unknown-keys discipline as opencode_plugin_config): set small_model to a cheap authed model resolved via agent_model_resolver (e.g. haiku-class when Anthropic authed; skip if none)
- Set username from the signed-in Rhythm user's display name (users service)
- Provide a Rhythm-managed reference map (obsidian vault path from MEMORY_VAULT_PATH env when set, repo docs dir) — additive, user entries preserved
- Write compaction/tool_output defaults ONLY if absent (never override user tuning)
- All writes followed by reloadConfig

## Non-goals (out)
- No UI for these knobs (settings surface is follow-up if wanted)
- Never override user-set values — absent-only writes except small_model/username which Rhythm owns

## Likely files
- apps/api_server/src/services/opencode_plugin_config.ts (or a sibling managed_config module)
- apps/api_server/src/services/agent_model_resolver.ts (cheap-model resolution helper)
- apps/api_server/src/server.ts

## Acceptance criteria
- Fresh machine: opencode.json gains the managed keys with correct values
- User-edited values for compaction/tool_output survive restarts untouched
- Title generation observably uses the small model (engine logs/cost — live-verify once)
- @vault/<note> reference resolves in a prompt when vault env is set

## Required tests
- Managed-config unit tests (fresh write, preserve-user, small_model resolution fallbacks incl. no-auth skip)

## Dependencies
None
