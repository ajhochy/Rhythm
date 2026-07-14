---
date: 2026-07-11
repo: Rhythm
branch: ocu-26-fork-spec-sdk-regen
status: ready-for-coding
issues: [1067]
order: 26
depends_on: []
tags: [issue, Rhythm, opencode-utilization, m6-platform]
---

# OCU-26 — Fork — regenerate openapi.json + SDK (include /skill/reload, /config/reload, allowlist PATCH body)

## Summary
The fork's checked-in OpenAPI spec and generated JS SDK predate the Rhythm fork endpoints: POST /skill/reload and POST /config/reload exist in server source (packages/opencode/src/server/routes/instance/httpapi/groups/instance.ts) but not in packages/docs/openapi.json (131 vs 133 ops) nor the generated SDK; PATCH /session/:id's typed body lacks mcpAllowlist/skillAllowlist/permissions. Regenerating the spec and SDK will make these endpoints and fields available for type-safe consumption in api_server (OCU-27).

## Scope (in)
- Run the fork's spec/SDK generation pipeline (locate the generate script in packages/sdk/js — likely driven from the server's /doc output or a codegen config)
- Commit regenerated openapi.json + sdk gen output
- Verify the generated session.update body includes the fork's allowlist/permission fields and pty/question/permission/skills namespaces are typed
- Rebuild the fork binary and run its existing test suite
- Do NOT change server behavior — regen only

## Non-goals (out)
- No api_server changes (OCU-27 adopts)
- No upstream rebase
- No new endpoints

## Likely files
- apps/opencode_fork/packages/docs/openapi.json
- apps/opencode_fork/packages/sdk/js/src/gen/
- apps/opencode_fork/packages/sdk/js/src/v2/gen/
- apps/opencode_fork/packages/sdk/js/package.json (only if the generate script needs wiring)
- Generation config/scripts within packages/sdk or packages/docs

## Acceptance criteria
- openapi.json contains 133 operations incl. skill.reload and config.reload
- Generated SDK exposes typed methods for them
- session.update input type carries mcpAllowlist/skillAllowlist (nullable) — diff shown in PR
- Fork build + tests green
- Binary rebuild verified per fork-rebuild gotcha (ad-hoc re-sign, no rc=137)

## Required tests
- Fork test suite
- A spec assertion test (operation count / named operationIds) if the fork has a home for it, else PR-body evidence

## Dependencies
None
