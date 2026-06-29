# Project State

## Current focus

**2026-06-28 — skill-unify2 epic (#791, 7 issues) in progress on
`feature/skill-unify2`.** Repurposes `agent_skills` as a sidecar
metadata + measurement ledger over the engine's live skill set and exposes a
unified read. Done so far: **#792** (sidecar columns + `findByName`, dual-DB
parity guard) and **#793** (`GET /opencode/skills?withMetadata=true` joins the
sidecar metadata onto live engine skills by name; plain endpoint unchanged so
the picker is unaffected). Auto-apply lifecycle is `active`/`measuring`/
`reverted` (no review queue). Remaining: #794 (auto-apply pipeline), #796
(unified menu), #797 (status reconciliation), + others.
See `docs/ai/runs/2026-06-28-issue-793-skills-withmetadata.md`.

---

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

- **skill-unify2 epic (#791):** `feature/skill-unify2` carries #792 (merged to it)
  and #793. #793 is committed on worktree branch
  `worktree-agent-ac659d2d43b6f8e25` (commit `6ddbcaadf`, **not pushed**) — verified,
  awaiting merge into `feature/skill-unify2`.
- **Branch:** `feature/unify-skills-source-of-truth` (stacked off
  `fix/issue-775-skill-allowlist-guard`). PR about to open against `main`; **do
  not merge** — human review + manual smoke first.
- **#775 / PR #776** remains open (smoke PASSED, ready for human merge). Merge
  #776 first or merge this PR after it, since this branch contains #775's commits.
- Ships only after a **fork rebuild + signed release** (the fork binary is
  bundled; release CI rebuilds it).

## In progress

- **skill-unify2:** #792 + #793 done + verified. Next: #794 (auto-apply pipeline),
  #796 (unified menu) — both consume `GET /opencode/skills?withMetadata=true`;
  #797 (status reconciliation of legacy draft/published rows).
- Skill-unification (unify-1..7) branch: awaiting (1) human review/merge of PR
  #776 then that PR; (2) post-merge manual smoke against a signed build.

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

- api_server (on `feature/skill-unify2` + #793): `tsc --noEmit` 0 errors,
  `npm run build` exit 0, `vitest run` **1355 pass / 161 files** (+4 from #793).
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

### 2026-06-28 — #795 improvement measurement + auto-revert (skill-unify2 epic #791, 4/7)
- Branch: `worktree-agent-a18ea0594522ae9d6` (based on `feature/skill-unify2`; has #792 + #793). Not pushed.
- Files modified:
  - `apps/api_server/src/services/skill_refiner.ts` — added a #795 purpose-anchored NUMERIC body scorer alongside the existing categorical judge (untouched). New exports: `SkillPurpose`, `ScoreResult`, `ScoreCall`, `parseScoreResponse` (fail-closed: no leading int → 0; clamps 0–100), `scoreSkillBody(purpose, body, scorer?)` (never throws; thrown scorer → 0). Fixed 0–100 rubric anchored to `name`+`description`+`whenToUse`; the scorer COMPARES the body (the categorical judge ignored it).
  - `apps/api_server/src/services/skill_measurement.ts` — NEW service (split per the issue's recommendation). `measureAppliedSkill(skill, deps)`: scores PRIOR body (from `agent_skill_versions` snapshot at `base_version`) as `baseline_score` + REVISED (live) body as `post_score`; persists both + `measure_reason`; KEEP iff `post > baseline` STRICTLY (status→active), else REVERT. Managed revert = `rollback(skillId, base_version)` + `writeManagedSkill(priorBody)` + `reloadSkills()`; external (`is_external=1`) revert = `deleteManagedSkill(name)` + `reloadSkills()`, NEVER writes `origin_location` (asserts byte-identical before/after, logs INVARIANT VIOLATION otherwise). `recoverStuckMeasurements(deps)`: reverts any `measuring` row at startup (fail-closed); `isTestEnv`/Postgres guarded. `candidateHash`/`revertedMarker` retain `reverted:hash:<sha256>` so #794's duplicate guard (applied_for_name + base_version + hash) skips the loser. Fire-and-forget, never-throws; best-effort reload (status commits after file op).
  - `apps/api_server/src/__tests__/skill_measurement.test.ts` — NEW. 18 cases: post>baseline kept/active+scores; post<=baseline managed revert (live body byte-identical to prior); external regression (shadow gone, origin bytes UNCHANGED, write never called); scorer throws + unparseable → fail-closed revert; crash recovery measuring→reverted; VITEST no-deps → zero work; marker keying; parseScoreResponse.
  - `apps/api_server/src/__tests__/skill_refiner.test.ts` — +4 cases for `parseScoreResponse` + `scoreSkillBody` (compares body, fail-closed).
- Checks run: `npx vitest run skill_measurement skill_refiner skill_apply agent_skills skill_schema_parity` 98 pass / 8 files; `npm run build` (tsc) exit 0; full `npx vitest run` **1370 pass / 162 files** (+15). Falsification verified: (a) relaxing `>` to `>=` fails the tie tests; (b) writing `origin_location` in external revert fails the byte-identical test. Both reverted.
- Decisions made: SPLIT into `skill_measurement.ts` (issue allowed it) — measure/decide/revert + crash recovery is substantial and keeps the refiner's scorer-only upgrade coherent. Built against the `measuring`-row DATA CONTRACT (#792 columns) not #794's code, since #794 is NOT on `feature/skill-unify2` yet (see Concerns).
- Deviations from spec: none functionally. Implemented against the sidecar data contract rather than importing `skill_apply.ts` because that file does not exist on this branch.
- Concerns: **#794 (`skill_apply.ts`) is NOT present on `feature/skill-unify2`** — branch carries only #792 + #793. The dispatch prompt stated #794 was merged; it was not. #795's measurement service is self-contained and correct against the documented `measuring`-row shape, but it has no live producer until #794 lands. #794 must (a) set `status='measuring'` + `applied_for_name`/`base_version`/`origin_location`/`is_external` + a `measure_reason='hash:<sha256>'`, (b) snapshot the prior body into `agent_skill_versions` at `base_version` (it does, via `reviseInPlace`), and (c) honor the `reverted:hash:<sha256>` duplicate-guard marker this service writes. #794 should call `measureAppliedSkill` in its fire-and-forget pass and `recoverStuckMeasurements` at service start.

### 2026-06-28 — #793 unified read: join sidecar metadata onto live engine skills (skill-unify2 epic #791, 2/7)
- Branch: `worktree-agent-ac659d2d43b6f8e25` (based on `feature/skill-unify2`, has #792). Not pushed.
- Files modified:
  - `apps/api_server/src/routes/opencode_skills_routes.ts` — `GET /` now accepts optional `?withMetadata=true`. Without it: unchanged `{name, description?, location, managed}` (Agent Profile picker unaffected). With it: each entry gains `metadata` joined by `name` via `AgentSkillsRepository.findByName` (O(n) over the live fork set, not N+1). Shape: `{confidence:number|null, version:number, status:'active'|'measuring'|'reverted'|null, source:string|null, uses:number|null, baselineScore:number|null, postScore:number|null, isExternalFork:boolean}`. Default when no sidecar row: `{confidence:null, version:1, status:'active', source:null, uses:null, baselineScore:null, postScore:null, isExternalFork:false}`. `managed` stays location-derived (`isManagedLocation`), NOT from the sidecar. The live set defines the name set — sidecar rows (incl. measuring/reverted) never become their own entry.
  - `apps/api_server/src/__tests__/opencode_skills_routes.test.ts` — 4 new cases under `?withMetadata=true`: (a) managed+sidecar, (b) external+sidecar (isExternalFork true, managed false), (c) no-sidecar default, names-alignment (with/without flag == fork list; a ghost measuring row is absent), falsification (zero live skills → [] despite a measuring sidecar row), and no-metadata-key without the flag.
- Checks run: `npx vitest run opencode_skills` 9 pass (5 orig + 4 new); `npm run build` (tsc) exit 0. Falsification verified by injecting a sidecar-row leak — names-alignment + the empty-set test both failed, then reverted.
- Decisions made: join is per-name via `findByName` against the global DB (no-arg repo ctor → `getDb()`, matches the test's `setDb`). Status narrowed to the data-only lifecycle set; legacy `draft`/`published` (reconciled in #797) map to `null`.
- Deviations from spec: none.
- Concerns: none. For #794 (auto-apply pipeline) and #796 (unified menu): consume `GET /opencode/skills?withMetadata=true` for provenance; the plain (no-flag) call is the picker's read and stays untouched.

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
