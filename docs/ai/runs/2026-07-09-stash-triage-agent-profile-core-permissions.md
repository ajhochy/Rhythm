---
date: 2026-07-09
repo: rhythm
branch: fix/agent-profile-core-permissions
pr: null
issues: []
status: implemented-verified-needs-manual-smoke
tags: [run, rhythm]
index: "[[Rhythm]]"
---

# Stash triage — recovered agent-profile core-permissions work

## Context

The stash `wip-929-inflight-stashed-for-949` (stash@{0}, created 2026-07-08 on
`issue-929-skill-self-regulation`, based on `main` @ 09253cd55) was
**mislabeled** — it contained none of issue #929's work. It held the durable
agent-profile permission fix from the 2026-07-07 session (see
`docs/ai/runs/2026-07-07-agent-profile-permission-fix.md` and
`docs/ai/runs/2026-07-07-agent-profile-permissions-blocked.md`). The branch
named there (`fix/agent-profile-core-permissions`) had been discarded, so the
stash was the only surviving copy.

No open or closed GitHub issue tracks this work. (A tracking issue was drafted
but the permission classifier declined the `gh issue create` — the task scope
was triage, not filing.)

## Files changed (14, 418 insertions)

- `apps/api_server/src/database/migrations.ts` — `core_permissions_json` column;
  Config Doctor prompt rewrite (MCP-vs-core permission semantics, REST
  PATCH+resync repair); seed core perms for `config-doctor` (`{"bash":"ask"}`)
  and `Theological-Researcher` (`{"skill":"allow","read":"allow","bash":"ask"}`).
- `apps/api_server/src/database/postgres_bootstrap.ts` — matching
  `ADD COLUMN IF NOT EXISTS` for `core_permissions_json` (+ system_prompt,
  allowed_mcps_json, allowed_skills_json backfills).
- `apps/api_server/src/repositories/agent_configs_repository.ts` —
  `corePermissionsJson` on model/input/row + insert/update/rowToModel.
- `apps/api_server/src/controllers/agent_configs_controller.ts` —
  `validateCorePermissionsJson` (allow/ask/deny actions or pattern objects);
  create + patch wiring.
- `apps/api_server/src/services/opencode_agent_writer.ts` — project
  `corePermissionsJson` into agent-file `permission:` frontmatter.
- `apps/api_server/src/services/agent_config_export_import.ts` — bundle field.
- `apps/api_server/src/server.ts` — reproject `config-doctor` +
  `Theological-Researcher` agent files on boot.
- `apps/mcp_server/src/tools/agentProfiles.ts` — new scoped MCP tools
  `rhythm_list/get/update_agent_profile_permissions` (permission fields only;
  never exposes prompts/secrets).
- Regression tests: `agent_configs.test.ts`, `agent_configs_routes.test.ts`,
  `agent_configs_repository.test.ts`, `opencode_agent_writer_projection.test.ts`,
  `tools/__tests__/agentProfiles.test.ts`.

`docs/ai/project-state.md` was intentionally excluded from the applied stash
(it carried a stale snapshot); restored to main's version, then updated fresh.

## Checks run — all green (commit 27c2f54ab)

- `apps/api_server` `tsc --noEmit`: OK.
- `apps/api_server` `vitest run`: 2458 passed / 1 skipped (287 files).
- `apps/api_server` `npm run build`: OK.
- `apps/mcp_server` `tsc --noEmit` + `vitest run`: 82/82 passed.
- `apps/mcp_server` `npm run build`: OK.
- GitNexus `detect_changes`: medium risk, only expected agent_configs symbols.
- CI (`MCP Server CI`, run 28994722949): green (`gh run watch` exit 0).

## Notes

- Applied with `git stash apply` (not pop) into a dedicated worktree
  `~/Documents/rhythm-worktrees/agent-profile-core-permissions`. **The stash is
  deliberately preserved** until this branch merges — do not drop it before then.
- Branch pushed to `origin/fix/agent-profile-core-permissions`. No PR opened yet
  (needs manual smoke + user sign-off; also awaiting confirmation the work is
  still wanted before opening).
- Postgres note: `core_permissions_json` reaches prod via the bootstrap ALTER —
  consistent with the schema-drift gotcha (SQLite tests only; prod is Postgres).
