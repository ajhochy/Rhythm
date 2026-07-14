---
date: 2026-07-07
repo: rhythm
branch: unknown
pr: null
issues: []
status: blocked
tags: [run, rhythm]
---

# Agent profile permissions investigation — blocked

## Summary
- Goal: durably fix `Theological-Researcher` so it can use the `defuddle` skill's shell/local-file needs, and teach/grant Config Doctor enough scoped permission-management capability to repair active profiles.
- Prior mistake in this session: a local SQLite-only patch created/updated `Theological-Researcher` in `/Users/ajhochhalter/Documents/Rhythm/rhythm.db` with `allowed_mcps_json` including `bash`. This is **not** confirmed as durable or correct, because `allowed_mcps_json` scopes MCP servers and `bash` may be an opencode/core tool controlled elsewhere.
- Correct next step: trace source-of-truth profile/toolset resolution before editing. Likely areas: `agent_configs_repository`, `agent_profile_scope`, `session_toolset_resolver`, `opencode_agent_writer`, `opencode_client_service`, config-doctor seed/profile tests, and any API route that updates active profile scope.

## Blocker
- Multiple delegated planning/coding subagents returned empty reports (`task` receipts only), so implementation could not be safely completed through the required workflow chain.

## Notes
- Do not repeat the local-only SQLite mutation as the final fix.
- Preserve scope semantics: `null` = unrestricted, omitted/undefined = no change, `[]` = deny-all.
- Use lowercase MCP scope names (`rhythm`, never `Rhythm`).
- Config Doctor/admin repair capability should be minimally scoped and auditable; do not give broad permission-editing power to arbitrary agents.

## Suggested validation next run
- Add/adjust regression tests for seeded canonical `Theological-Researcher` and `config-doctor` profile scopes.
- Verify whether shell/bash is represented as an MCP server, opencode core tool, or generated agent/tool config.
- Run targeted api_server tests around agent config/profile scope plus relevant opencode profile materialization tests.
