# Project State

## Current focus

**2026-06-28 — Skills unified onto the opencode engine (7 issues), verified on a
branch stacked over #775.** The engine's filesystem skill store is now the single
source of truth: api_server proxies the fork's live `GET /skill` and writes
Rhythm-owned `SKILL.md` into an additively-registered managed dir; the fork gained
a `POST /skill/reload` re-scan trigger; both Flutter pickers (skills + MCP) read
live data and the skills picker authors managed skills; `agent_profile_sync` now
validates derived allowlists against the live skill set; published DB skills
materialize to `SKILL.md`. All three hardcoded skill-name lists are gone.
Supersedes #777. See `docs/ai/runs/2026-06-28-unify-skills-source-of-truth.md`
and `docs/ai/decisions/2026-06-28-unify-skills-source-of-truth.md`.

Builds on **#775** (per-session `skillAllowlist` enforcement, PR #776, smoke
PASSED) — this work keeps the picker names aligned with what #775 enforces.

## Active branch / PR

- **Branch:** `feature/unify-skills-source-of-truth` (stacked off
  `fix/issue-775-skill-allowlist-guard`). PR about to open against `main`; **do
  not merge** — human review + manual smoke first.
- **#775 / PR #776** remains open (smoke PASSED, ready for human merge). Merge
  #776 first or merge this PR after it, since this branch contains #775's commits.
- Ships only after a **fork rebuild + signed release** (the fork binary is
  bundled; release CI rebuilds it).

## In progress

- Nothing actively coding. Awaiting: (1) human review/merge of PR #776 then this
  PR; (2) post-merge manual smoke against a signed build.

## Risks / known issues

- **Visual/live smoke deferred (needs signed fork rebuild):** the new pickers
  only exercise `GET/POST /skill` + `POST /skill/reload` against a rebuilt+signed
  fork binary. Behavior is covered by widget tests against the real
  `AgentProfileSheet`; pixel/interaction confirmation is a post-merge manual item.
- **6 pre-existing failures** in `agent_trigger_watcher_test.dart` (auth-change/F2)
  — unrelated to this work (fail in isolation, no import of changed files); a
  follow-up was spawned. Do not attribute to skill unification.
- Managed skills dir is `~/.config/opencode/rhythm-managed-skills` (env-overridable
  via `RHYTHM_MANAGED_SKILLS_DIR`); registered additively in `skills.paths` — must
  never collide with the `sync-globals` paths (`~/.claude/skills` etc.).
- Fork binary is gitignored + per-branch; release CI rebuilds + signs it.
- **#737 fencing scope:** only gmail MCP tool results are fenced (follow-up).

## Test status

- api_server: `tsc --noEmit` 0 errors, `npm run build` exit 0, `vitest run`
  **1344 pass / 160 files**.
- Fork: `bun test` skill+tool **20 pass/0 fail**; httpapi-exercise (coverage/auth/
  effect) **149 pass/0 missing** each.
- Flutter: `analyze --no-fatal-infos` 0 errors/0 warnings; agents widget tests
  **14 pass** (6 unrelated pre-existing trigger-watcher failures noted above).
- New real-binary guard `smoke_skill_alignment.sh` wired into `desktop_release.yml`.

## Pending manual smoke (post-merge, against a signed build)

- **Skills unification (this run):** Agent Profiles → a profile → Agent Profile
  sheet. Confirm (a) Skills picker after "Restrict" lists the engine's **live**
  skill names (not 14 hardcoded); (b) a managed skill shows edit/delete + "New
  skill" round-trips (create → appears → editable); (c) external skills show no
  edit/delete; (d) MCP picker after "Restrict" lists live server names, empty
  state when none; (e) Settings → Server URL change does not affect either picker;
  (f) a published DB skill appears in the picker and a scoped session still omits
  out-of-scope skills (#775 intact).
- Carry-over (still owed from prior batch): #720 compaction divider, #723 MCP
  remove/sync, #731 shell-runner removal, #736 WS tool-gating, #770 Brain
  mirror-sync, #737 email fencing. (#765 MCP scoping + #775 skill scoping already
  smoked — skip.)

## Next step

Open the PR for `feature/unify-skills-source-of-truth` (draft, no merge) with
`Closes #777`. Then human-merge #776 and this PR, cut a signed release, and work
the post-merge manual-smoke list against that build.

## Recent coding-agent runs

### 2026-06-28 — #792 agent_skills sidecar metadata + measurement ledger (skill-unify2 epic #791)
- Files modified:
  - `apps/api_server/src/database/migrations.ts` — 7 additive guarded ALTER columns on `agent_skills` (applied_for_name, base_version, origin_location, is_external DEFAULT 0, baseline_score, post_score, measure_reason) + `idx_agent_skills_applied_for_name`; documented data-only status lifecycle active/measuring/reverted (no human gate).
  - `apps/api_server/src/database/postgres_bootstrap.ts` — matching `ADD COLUMN IF NOT EXISTS` for all 7 + the same index (dual-DB parity).
  - `apps/api_server/src/models/agent_skill.ts` — camelCase fields on `AgentSkill` + `AgentSkillInput` (appliedForName, baseVersion, originLocation, isExternal, baselineScore, postScore, measureReason).
  - `apps/api_server/src/repositories/agent_skills_repository.ts` — row type + rowToModel + create/update round-trip the 7 columns; added `findByName(name)` (join key = SKILL.md frontmatter name, stored in `title`); `findByTitle` now delegates to it.
  - `apps/api_server/src/__tests__/skill_schema_parity.test.ts` — NEW dynamic dual-DB parity guard (real SQLite PRAGMA vs. statically parsed Postgres DDL) for `agent_skills` + `agent_skill_versions`.
  - `apps/api_server/src/__tests__/agent_skills_repository.test.ts` — round-trip + findByName + status-lifecycle (measuring/reverted/active) tests.
  - `issue_p1_1_agent_skills.test.ts`, `skill_retrieval.test.ts`, `skill_injection.test.ts`, `services/__tests__/skill_materializer.test.ts` — updated stale `AgentSkill` literals/column list for the 7 new required fields.
- Checks run: `npm run build` (tsc) exit 0; `vitest run skill_schema_parity agent_skills issue_p1_1_agent_skills` green; full `vitest run` 1351 pass / 161 files (was 1344). Falsification verified: a SQLite-only column makes the parity test fail.
- Decisions made: join key is the existing `title` column (SKILL.md `name` was already stored there as the dedup key) — `findByName` is canonical, `findByTitle` delegates. Postgres DDL is parsed statically (bootstrap needs a live Pool, can't execute in-test).
- Deviations from spec: none. Table kept named `agent_skills`; `agent_skill_versions` untouched; all changes additive + idempotent.
- Concerns: legacy `draft`/`published` status values still on existing rows (reconciled in #797 per spec). #793 (unified read) will join this sidecar onto live engine skills via `findByName`.
