---
date: 2026-07-11
repo: Rhythm
branch: ocu-09-commands-crud-routes
status: ready-for-coding
issues: [1050]
order: 09
depends_on: []
tags: [issue, Rhythm, opencode-utilization, m2-playbooks]
---

# OCU-09 — Commands CRUD routes writing commands/*.md + config reload (Playbooks backend)

## Summary

Mirror the existing skills routes pattern to expose engine slash commands as an API. Engine command files live at `~/.config/opencode/commands/<name>.md` with frontmatter (description, agent, model, subtask) and body containing prompt template with `$ARGUMENTS` or `$1..$n` placeholders. After any file write, POST /config/reload makes them live. A GET /command wrapper on the engine lists all commands with source metadata.

## Scope (in)

- New Express router `/opencode/commands`: GET / (merge engine command.list — wrapper exists as listCommands at apps/api_server/src/services/opencode_client_service.ts:771 — with on-disk managed files, flag which are Rhythm-managed vs built-in/MCP-sourced); GET /:name/content (frontmatter + body); POST / and PUT /:name (validate name kebab-case + no collision with built-ins, write file, reloadConfig — wrapper exists at :1248); DELETE /:name (managed files only, rm + reloadConfig); register router in app.ts

## Non-goals (out)

- No Flutter UI (OCU-10/11)
- No per-command permission model
- Do not touch built-in or MCP-prompt commands on disk
- No changes to production user data beyond what the spec names

## Likely files

- apps/api_server/src/routes/opencode_commands_routes.ts (new)
- apps/api_server/src/app.ts
- apps/api_server/src/services/opencode_client_service.ts (only if a command-list metadata tweak is needed)
- reference pattern: apps/api_server/src/routes/opencode_skills_routes.ts

## Acceptance criteria

- POST then GET round-trips a command
- After POST, the engine's GET /command includes it live (no restart)
- PUT preserves unknown frontmatter keys
- DELETE refuses non-managed commands with 400
- Collision with a built-in name → 409

## Required tests

- Route contract tests in src/__tests__ (mirror opencode_skills_routes tests): CRUD round-trip, collision, reload called per mutation

## Dependencies

None
