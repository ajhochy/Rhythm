---
date: 2026-07-11
repo: Rhythm
branch: ocu-08-enable-websearch
status: ready-for-coding
issues: [1049]
order: 08
depends_on: []
tags: [issue, Rhythm, opencode-utilization, m1-interaction-polish]
---

# OCU-08 — Enable engine websearch tool (provider env + key plumbing)

## Summary

The engine ships a native websearch tool (Exa or Parallel backends) gated on environment variables. Rhythm spawns the engine with none of these, so no agent can natively search the web despite Deep Research being a flagship feature. This issue wires the websearch provider and API key through Rhythm's config surface and into the engine spawn.

## Scope (in)

- Add websearch provider + API key to Rhythm's config surface (config/env.ts + rhythm_config store, following the existing pattern for provider keys)
- When configured, inject OPENCODE_WEBSEARCH_PROVIDER + key env into the engine spawn in opencode_client_service.initialize
- Expose configured/not state in the existing capabilities/status surface so the UI can show it
- Leave off (no env) when unconfigured

## Non-goals (out)

- No custom search UI; agents use the tool autonomously
- No per-profile websearch toggles beyond existing permission keys
- No changes to production user data; local agent-server (port 4001) surface only unless the spec says otherwise

## Likely files

- apps/api_server/src/services/opencode_client_service.ts
- apps/api_server/src/config/env.ts
- apps/api_server/src/cli/setup/rhythm_config_store.ts
- apps/api_server/src/config/rhythm_config.ts

## Acceptance criteria

- With a key configured, GET /experimental/tool/ids on the running engine includes websearch and an agent prompt "search the web for X" performs a real search
- With no key, engine spawns exactly as today (no env delta)
- Key is never logged

## Required tests

- Spawn-env unit test (key present → env injected; absent → not)
- Config-store round-trip test

## Dependencies

None
