---
date: 2026-06-28
repo: Rhythm
branch: feature/unify-skills-source-of-truth
pr: pending
issues: [unify-1, unify-2, unify-3, unify-4, unify-5, unify-6, unify-7, "777 (superseded)"]
status: verified-pending-pr
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# Run — Unify skills into one source of truth on the opencode engine

Full workflow run (plan → issues → implement) on a branch stacked off the open
#775 branch (PR #776), so #775's `skillAllowlist` enforcement code is present.
Makes the engine's filesystem skill store the single source of truth and
eliminates the three hardcoded skill-name lists. Supersedes #777.

## Files changed

**Fork (unify-1 — `Skill.reload()` re-scan trigger):**
- `apps/opencode_fork/.../src/skill/index.ts` — `reload()` interface method;
  invalidates the memoized `discovered`+`state` InstanceState caches, re-scans.
- `.../httpapi/groups/instance.ts`, `.../handlers/instance.ts` — `POST /skill/reload`.
- `.../test/skill/skill.test.ts` — reload busts the stale memoized set.
- `.../test/server/httpapi-exercise/index.ts` — coverage scenario for the new route.

**api_server (unify-2/3/6/7):**
- `services/rhythm_managed_skills.ts` (new) — lazy `managedSkillsRoot()`
  (`RHYTHM_MANAGED_SKILLS_DIR` env-overridable for tests), additive
  `ensureManagedSkillsDirRegistered()` (writes `skills.paths` in opencode.json),
  validated `writeManagedSkill`/`deleteManagedSkill`, `isManagedLocation`.
- `routes/opencode_skills_routes.ts` (new) — `GET/POST/PUT/DELETE /opencode/skills`.
- `services/opencode_client_service.ts` — `listSkills()` / `reloadSkills()` (raw
  fetch to the fork instance routes with `?directory=`).
- `services/agent_profile_sync.ts` — `filterAllowlistToLive()` intersects derived
  allowlists with the live `GET /skill` names (drops dead names; fail-open).
- `services/skill_materializer.ts` (new) + `controllers/agentSkillsController.ts`
  — publish → write SKILL.md to managed dir + reload; unpublish/delete → remove.
- `services/skill_retrieval.ts` — doc comment: `buildSkillsPreface` is an inert
  hint, not the capability gate.
- `app.ts` (mount), `server.ts` (register managed dir at boot).
- tests: `opencode_skills_routes.test.ts`, `agent_profile_sync_skill_alignment.test.ts`,
  `skill_materializer.test.ts`, `skill_names_alignment.test.ts`;
  `agent_skills_routes.test.ts` isolated via the env override.

**Flutter (unify-4/5 — dispatched to a background coding-agent):**
- `features/agents/data/opencode_skills_data_source.dart` (new),
  `features/agents/data/opencode_mcp_data_source.dart` (new),
  `features/agents/views/_managed_skill_editor_sheet.dart` (new),
  `features/agents/views/_agent_profile_sheet.dart` (removed `_kAvailableSkills`
  + `_kAvailableMcps`; pickers load live; managed-editable / external-readonly),
  `test/features/agents/agent_profile_skills_mcp_picker_test.dart` (new, 8 tests).

**Guards / CI (unify-7):**
- `tools/release/smoke_skill_alignment.sh` (new) + `desktop_release.yml` (wired):
  no-skill-lost + managed-skill-discovered + names-alignment on the built binary.

**Docs:** `docs/ai/current-plan.md`, `docs/ai/decisions/2026-06-28-unify-skills-source-of-truth.md`,
`docs/ai/generated-issues/unify-0*.md`.

## Checks run (verification-gate, all same-response)

- api_server `tsc --noEmit` → 0 errors; `npm run build` (tsc -p) → exit 0.
- api_server `vitest run` → **1344 passed / 160 files**.
- Fork `bun test` skill + tool/skill → **20 pass / 0 fail**; httpapi-exercise
  coverage+auth+effect → **149 pass / 0 missing** each.
- Flutter `analyze --no-fatal-infos lib/features/agents/` → 39 info, **0 errors/0
  warnings, exit 0**; widget tests → **14 pass** (8 picker + 6 model).
- Reference check: `_kAvailableSkills`/`_kAvailableMcps` → **zero stale references**.

## Notes

- **Decision:** System B (DB skill store) kept as authoring layer →
  materialize-on-publish (vs retire). Full unification this run. Stack off #775.
  Rationale in the decision doc.
- **Deferred to post-merge manual smoke (needs signed fork rebuild):** the pixel/
  live-stack visual probe of the pickers — the new endpoints only run against a
  rebuilt+signed fork binary, which the plan scoped out of this run (same #775
  precedent). Behavioral contract is covered by widget tests against the real
  `AgentProfileSheet`. See project-state "manual smoke".
- **Pre-existing, out of scope:** 6 failures in
  `apps/desktop_flutter/test/features/agents/agent_trigger_watcher_test.dart`
  (auth-change/F2) — fail in isolation, don't import changed files, not introduced
  here. Flutter agent spawned a follow-up.
- No repair loop (failure-triage) was needed; all checks passed first time.
