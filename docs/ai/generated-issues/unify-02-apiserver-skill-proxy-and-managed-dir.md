# api_server: proxy `GET /skill` + Rhythm-managed dir write/delete + register dir

**Order:** 2 · **Depends on:** #1 (fork reload route) · **Milestone:** Unify skills source of truth

## Why

The Flutter pickers and `agent_profile_sync` must source from the engine's live skill set, and
users must be able to author Rhythm-owned skills into the canonical store. api_server is
co-located with the fork and already proxies it (`opencode_models_routes`, `opencode_mcp_routes`),
so it is the right mediator for both read and write.

## What

1. **Read proxy:** `GET /opencode/skills` returns the fork's `GET /skill` list with the heavy
   `content` field stripped (name, description, location, and a derived `managed: boolean`
   flag indicating whether `location` is inside the Rhythm-managed dir).
2. **Managed dir:** define a Rhythm-managed skills dir (must NOT collide with the
   `sync-globals` paths `~/.claude/skills`, `~/.codex/skills`, `~/.config/opencode/skills`).
   Register it with the fork **additively** via `config.skills.paths` (through the existing
   opencode config writer), preserving all existing scan dirs.
3. **Write/delete:** `POST` / `PUT` / `DELETE` endpoints that create/edit/delete a `SKILL.md`
   in the managed dir only, then call the fork reload route (#1) so the change is live.

## Acceptance criteria

1. `GET /opencode/skills` returns the same skill names as the fork's `GET /skill` (content
   stripped), each tagged `managed` true/false by whether its `location` is under the managed dir.
2. Creating a skill via `POST` writes a valid `SKILL.md` (frontmatter `name` + `description`)
   **inside the managed dir** and, after the call returns, the skill appears in
   `GET /opencode/skills` (reload was triggered).
3. **Boundary:** a write whose target name/path resolves outside the managed dir (e.g. contains
   `..` or an absolute path) is rejected with a 4xx and writes nothing.
4. **Boundary:** `DELETE` only removes files inside the managed dir; attempting to delete a
   non-managed (external) skill is rejected.
5. Registering the managed dir does **not** drop any existing scan dir (verified by issue 7's
   no-skill-lost check).
6. Routes respect the existing auth posture (`requireAuth` unless `AGENT_LOCAL`), mirroring the
   other `/opencode/*` routers.

## Likely files

- `apps/api_server/src/routes/opencode_skills_routes.ts` (new)
- `apps/api_server/src/controllers/opencode_skills_controller.ts` (new)
- `apps/api_server/src/services/opencode_client_service.ts` (add `listSkills()`, `reloadSkills()`)
- `apps/api_server/src/services/opencode_plugin_config.ts` (register managed dir in `skills.paths`)
- `apps/api_server/src/app.ts` (mount `/opencode/skills`)
- `apps/api_server/src/**/__tests__/opencode_skills*.test.ts` (new)

## Required tests

- Vitest: proxy maps fork list → stripped list with `managed` flag.
- Vitest: create writes SKILL.md in managed dir; reload client method called.
- Vitest: path-traversal / outside-dir write rejected; external-skill delete rejected.

## Data-safety / out-of-scope

- Writes confined to the managed dir; never write to or relocate sync-globals paths.
- No new `agent_configs` columns (so no Postgres backfill needed).
- Materialize-on-publish of DB skills is issue 6, not here.

## Verification

- `ai-workflow checks --level issue` (api_server vitest).
