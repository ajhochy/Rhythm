---
date: 2026-07-11
repo: Rhythm
branch: ocu-12-org-skill-index-endpoint
status: ready-for-coding
issues: [1053]
order: 12
depends_on: []
tags: [issue, Rhythm, opencode-utilization, m3-org-skill-library]
---

# OCU-12 — Org skill index endpoint on production API (index.json + file serving)

## Summary

The engine consumes remote skill libraries via config `skills.urls`: each URL must serve an index.json enumerating skills and their files (SKILL.md required per skill), which the engine downloads and caches locally. Rhythm's production API will host the org's shared skill library so every staff machine inherits org skills. NOTE: any new table needs postgres_bootstrap.ts backfill due to Postgres/SQLite schema drift.

## Scope (in)

- New org-skills storage (table org_skills: name, description, skill_md body, optional extra files as rows or JSON, updated_at, published flag) with migrations.ts + postgres_bootstrap.ts entries
- Public-read endpoints GET /org-skills/index.json (engine-compatible index format: skill name → file list with URLs) and GET /org-skills/files/<skill>/<path> serving file bodies
- Writes require auth (existing JWT middleware) — POST/PUT/DELETE /org-skills/:name
- Keep the index format exactly what the fork's skill/discovery.ts expects (verify against apps/opencode_fork/packages/opencode/src/skill/discovery.ts before finalizing shapes)

## Non-goals (out)

- No engine-side changes
- No approval workflow (OCU-15)
- No local api_server consumption (OCU-13)
- Read endpoints are unauthenticated by design decision — org skills must not contain secrets; document this in the route file
- No changes to production user data beyond what the spec names

## Likely files

- apps/api_server/src/routes/org_skills_routes.ts (new)
- apps/api_server/src/repositories/org_skills_repository.ts (new)
- apps/api_server/src/database/migrations.ts
- apps/api_server/src/database/postgres_bootstrap.ts
- apps/api_server/src/app.ts
- reference: apps/opencode_fork/packages/opencode/src/skill/discovery.ts

## Acceptance criteria

- index.json validates against the fork discovery parser (a fork-side unit fixture or live engine fetch loads it)
- published=false skills excluded from index
- Write endpoints reject unauthenticated requests
- Works on both SQLite (tests) and Postgres (bootstrap verified)

## Required tests

- Route contract tests (index shape, file serving, auth on writes, unpublished exclusion)
- A fixture test that feeds the generated index.json through the same shape the fork expects

## Dependencies

None
