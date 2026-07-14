---
date: 2026-07-11
repo: Rhythm
branch: ocu-31-org-instructions
status: ready-for-coding
issues: [1072]
order: 31
depends_on: []
tags: [issue, Rhythm, opencode-utilization, m6-platform]
---

# OCU-31 — Org instructions file synced from production

## Summary
The engine's `instructions` config key takes instruction file globs whose contents concatenate into every agent's context across config sources — a lighter-weight org-policy channel than editing every agent .md. Rhythm can sync one org-policy markdown from the production API and register it.

## Scope (in)
- Production: org_settings storage for a single org-instructions markdown (authed write endpoint, public/authed read — follow OCU-12's auth posture; add postgres_bootstrap backfill)
- Local: fetch on engine init + daily, write to a Rhythm-managed file under the opencode config dir, ensure instructions array contains its path (preserve user entries), reloadConfig on change
- Empty/unreachable → keep last cached copy, never block startup

## Non-goals (out)
- No editor UI (edit via API/admin for now — follow-up)
- No per-agent instruction targeting

## Likely files
- apps/api_server/src/routes/org_settings_routes.ts (new)
- apps/api_server/src/database/migrations.ts
- apps/api_server/src/database/postgres_bootstrap.ts
- apps/api_server/src/services/opencode_plugin_config.ts (instructions entry management)
- apps/api_server/src/server.ts

## Acceptance criteria
- Setting org instructions on prod → within a day (or on restart) every machine's agents observably follow the instruction (live-verify with a marker instruction, e.g. a sign-off phrase)
- User instructions entries preserved
- Offline start serves cached copy

## Required tests
- Route tests (auth, round-trip)
- Local sync unit tests (fetch/write/register/cache-fallback)

## Dependencies
None
