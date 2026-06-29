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

### 2026-06-28 — #796 standalone Skills menu → one unified engine-skill list (skill-unify2 5/7; subsumes #779)
- Branch: `worktree-agent-a4c90fff5c16c60ec` (based on `cb18c083e`, the feature/skill-unify2 tip with #792–#795). Not pushed.
- Converted the standalone Skills menu (Agents → Tools → Skills) from the `/agent-skills` DB store to the unified read `GET /opencode/skills?withMetadata=true` (#793). Auto-apply model only — IGNORED the issue body's stale proposal-queue / Approve-Reject / hasProposals / publish language (epic moved to auto-apply + measure + auto-revert).
- Files modified:
  - `apps/desktop_flutter/lib/features/agents/data/opencode_skills_data_source.dart` — added `OpencodeSkillMetadata` model (mirrors api_server `SkillMetadata`: confidence/version/status/source/uses/baselineScore/postScore/isExternalFork), extended `OpencodeSkillEntry` with an optional `metadata` field parsed from the `metadata` key, and added `listWithMetadata()` hitting `?withMetadata=true` (degrades to `[]` on error — no hardcoded fallback). Targets `AppConstants.agentLocalBaseUrl` (:4001).
  - `apps/desktop_flutter/lib/features/agent_skills/controllers/agent_skills_controller.dart` — rewritten to be backed by `OpencodeSkillsDataSource` (was `AgentSkillsRepository`). `loadSkills()` reads the unified list; `deleteSkill(name)` (managed only) + re-fetch; exposes `dataSource` + `skillNames` for the editor sheet. Removed publish/version/rollback (DB-only concepts gone from the unified read).
  - `apps/desktop_flutter/lib/features/agent_skills/views/agent_skills_view.dart` — rewritten: unified list, MANAGED/EXTERNAL provenance badge per row, non-`active` status badge (measuring amber / reverted red), source·confidence·version·uses meta line, baseline→post score line when measured, "auto-improved (forked)" note when `isExternalFork`. Managed rows show edit (reuse `showManagedSkillEditorSheet`) + delete; external/handwritten rows are read-only (lock icon, no edit/delete). Top-level "New skill" create button. Loading/error/empty states keyed.
  - `apps/desktop_flutter/lib/main.dart` — provider now `AgentSkillsController(OpencodeSkillsDataSource())`; dropped the 3 retired imports.
  - DELETED (retired DB-only path): `agent_skills/data/agent_skills_data_source.dart`, `repositories/agent_skills_repository.dart`, `models/agent_skill.dart`, `models/agent_skill_version.dart`. No dead reference remains (only a doc-comment mention of the old `/agent-skills` store).
  - `apps/desktop_flutter/test/features/agent_skills/agent_skills_view_test.dart` — rewritten for the new surface (fake extends `OpencodeSkillsDataSource`): lists managed+external with badges; lifecycle status + baseline→post score; managed edit+delete vs external read-only; "New skill" opens editor + round-trips create; delete (confirmed) calls `delete`; loading/error(+no fallback)/empty; a unit asserting `agentLocalBaseUrl` is localhost:4001.
- Checks run:
  - `dart format` on the changed files — applied (4 changed).
  - `flutter analyze --no-fatal-infos lib/features/agent_skills/ lib/features/agents/ test/features/agent_skills/` → 0 errors / 0 warnings (39 pre-existing `info` lints, none in changed files).
  - `flutter test test/features/agent_skills/` → 10/10 pass. Full `test/features/agents/` run → 6 failures, all in `agent_trigger_watcher_test.dart` (the documented pre-existing F2 failures — unrelated).
  - Falsification (both reverted): unconditioning the managed edit gate → "managed vs external read-only" test FAILS (external shows edit); suppressing the score line → "lifecycle + baseline→post score" test FAILS.
- Decisions made: kept the `AgentSkill`-named DB model deleted rather than adapting it — the unified read returns `OpencodeSkillEntry` (+ metadata), so the menu and the Agent Profile picker now share ONE model. The api_server `/agent-skills` route is left intact (other consumers); only the Flutter menu's read path moved. The external-fork shows as a single MANAGED row with the auto-improved note (shadowing model, per #794 decision OQ#1).
- Deviations from spec: per the dispatch SPEC CORRECTION, omitted the issue body's proposal queue / Approve-Reject / hasProposals / publish / "Improve (fork to managed)" actions — those do not exist in the auto-apply model. Surfaced lifecycle + scores from the unified read instead.
- Concerns: none material. Visual/live smoke still deferred (needs a signed fork rebuild to exercise the real `:4001` endpoint).

### 2026-06-28 — #794+#795 wiring: auto-apply → measure/auto-revert end-to-end + startup stuck-measuring recovery
- Branch: `worktree-agent-aebf7480150a4127b` (based on `009eda81a`, has both #794 `skill_apply.ts` and #795 `skill_measurement.ts`). Not pushed.
- The gap: `applyToEngineSkill` (#794) left the sidecar row at `status='measuring'` but never called `measureAppliedSkill` (#795), and `server.ts` never called `recoverStuckMeasurements()` at startup — so applied revisions got stuck `measuring` forever.
- Files modified:
  - `apps/api_server/src/services/skill_apply.ts` — NEW `applyAndMeasure(candidate, deps)`: calls `applyToEngineSkill`, and on an `applied-managed`/`applied-external-fork` outcome re-fetches the just-applied `measuring` row via `repo.findByName(candidate.name)` and hands it to #795's `measureAppliedSkill(row, { repo })`. Threads the SAME repo (apply+measure share one DB); measure's own deps default to the real scorer / managed-skill write+delete / reloadSkills. Lazy `await import('./skill_measurement')` breaks the eval-time cycle (apply→measurement→refiner→apply). Never-throws (a measure failure is non-fatal — startup recovery catches stragglers). Added injectable `measure?` hook (`MeasureFn`) + `MeasureFn` type. `applyToEngineSkill` itself is UNCHANGED (its 13 tests stay on `measuring` as terminal).
  - `apps/api_server/src/services/skill_refiner.ts` — default `applyToEngine` now `applyAndMeasure` (was `applyToEngineSkill`); import + `RefineDeps.applyToEngine` JSDoc updated. The injectable hook keeps the refiner tests' doubles intact.
  - `apps/api_server/src/server.ts` — at agent-execution startup (inside `if (env.agentExecutionEnabled)`, after the skill seed) a non-blocking `void (async () => { recoverStuckMeasurements() })()` — defensive crash recovery; non-fatal if it throws; no-op under Postgres/VITEST (guards in #795).
  - `apps/api_server/src/__tests__/skill_apply_measure_e2e.test.ts` (NEW, 4 tests) — REAL `applyAndMeasure` chain (only LLM scorer + managed-dir IO faked): improving (post>baseline) → `active`; non-improving (post≤baseline) → `reverted` + body rolled back byte-identical; no-target → returned without measuring; `recoverStuckMeasurements` reverts a crash-stuck `measuring` row.
- Checks run:
  - `npx vitest run skill_apply skill_measurement skill_refiner agent_skills` → 112/112 PASS.
  - `npm run build` (tsc -p tsconfig.json) → exit 0.
  - Full `npx vitest run` → 1387 pass / 164 files (was 1368/162 at #794; +my 4 e2e tests +2 files net from the stacked deltas).
  - Falsification: forcing `applyAndMeasure` to skip the measure step → both e2e tests FAIL with the row stuck `'measuring'` (`expected 'measuring' to be 'active'` / `'reverted'`); reverted.
- Decisions made: wired the chain via a NEW `applyAndMeasure` rather than firing measure inside `applyToEngineSkill`, so #794's 13 apply tests (which assert `measuring` as terminal + exact reload counts) stay untouched. Lazy import of `skill_measurement` to avoid the eval-time circular dependency. Re-fetch the measuring row by name (`applyToEngineSkill` returns only an outcome string; `recordAutoApply` already wrote the row).
- Deviations from spec: none. (Task said "same fire-and-forget pass" — `applyAndMeasure` is that single pass; the refiner calls it as one step.)
- Concerns: none material. The e2e tests run the real measure with injected IO; production wires the same chain with default (real) deps behind the existing isTestEnv/Postgres short-circuits.

### 2026-06-28 — #794 auto-apply pipeline: re-target loop at live engine skills (skill-unify2 epic #791, 3/7)
- Branch: `worktree-agent-a87f99ac094f4a555` (based on `feature/skill-unify2`, has #792+#793). Not pushed.
- Replaces the old "proposal queue / human gate" spec: the loop AUTO-APPLIES a passing revision
  (writes a SKILL.md), moves the sidecar row to `status='measuring'`, and hands off to #795
  (measure + auto-revert). Generalizes the prior DB-row-only `reviseInPlace` to the LIVE engine
  skill set.
- Files modified:
  - `apps/api_server/src/services/skill_apply.ts` (new) — `applyToEngineSkill(candidate, deps)`:
    target resolution over the live set (`resolveLiveTarget`, exact case-insensitive name),
    pre-apply gate (confidence ≥ 0.6 AND ≥ existing sidecar confidence), duplicate-apply guard
    (`hasAutoAppliedRow` by name+base_version+body-hash, status measuring/reverted),
    MANAGED path (revise in place) vs EXTERNAL path (fork-to-shadow, original NEVER written),
    `hashBody` sha256, all writes via injectable `writeSkill`→`writeManagedSkill`. isTestEnv +
    Postgres no-op + never-throws guards mirror skill_extractor/refiner.
  - `apps/api_server/src/repositories/agent_skills_repository.ts` — `recordAutoApply(...)`
    (lazy-create-or-reuse sidecar row by name, snapshot PRIOR body into agent_skill_versions as
    the rollback base, write revised body + measuring + version bump + ledger cols) and
    `hasAutoAppliedRow(name, baseVersion, hash)` (candidate hash stored in `measure_reason` as
    `hash:<sha256>` — no new column).
  - `apps/api_server/src/services/skill_refiner.ts` — re-targeted apply branch: on a 'better'
    verdict the refiner now calls injectable `applyToEngine` (default `applyToEngineSkill`) with
    the matched engine skill `name` (= title) + a rendered body, mapping
    applied-managed/applied-external-fork → 'revised', else → 'kept'. Added `renderCandidateBody`.
    No longer calls `reviseInPlace` directly (that now lives inside `recordAutoApply`).
  - `apps/api_server/src/__tests__/skill_apply.test.ts` (new) — 13 tests: managed in-place
    (version bump + prior-body snapshot + reload + is_external=0), external fork-to-shadow
    (is_external=1, origin recorded, external file never handed to writeSkill, original bytes
    snapshotted as base), duplicate guard (measuring + reverted), pre-apply gate (floor + <existing),
    no-target, VITEST→skipped/zero writes, resolveLiveTarget units.
  - `apps/api_server/src/__tests__/skill_refiner.test.ts` — updated to the new seam: a 'better'
    verdict now delegates to an injected `applyToEngine` double (asserts call + name/confidence/
    source + body), worse/equal/throw/low-conf/no-match never call apply, no-target→kept.
- Checks run:
  - `npx vitest run skill_apply skill_refiner skill_extractor agent_skills opencode_skills_routes skill_schema_parity` → 120/120 PASS.
  - Full suite `npx vitest run` → 1368 pass / 162 files (baseline 1344/160; +24 tests, +2 files).
  - `npm run build` (tsc -p tsconfig.json --noEmit) → exit 0.
  - Falsification (each reverted): disabling `hasAutoAppliedRow` → both duplicate tests FAIL;
    snapshotting revisedBody instead of priorBody → managed-snapshot + external-base tests FAIL;
    removing the isTestEnv guard → VITEST-guard test FAILS.
- Decisions made: external-fork uses the SAME `name` (decision-doc OQ#1 recommendation, shadows
  the external in the picker). base_version for the duplicate guard uses the row's RECORDED
  base_version when status is measuring/reverted (so a re-distill of the same body while in-flight
  still matches), else the current version. Candidate hash piggybacks `measure_reason` (`hash:<sha>`)
  to avoid a new column / migration / Postgres-parity change. The refiner now OWNS only the gate
  decision + delegation; the SKILL.md write + version bump moved into skill_apply/recordAutoApply.
- Deviations from spec: none. (Issue body authoritatively overrides the decision doc's
  propose→review→apply with auto-apply; implemented auto-apply.)
- #795 SEAM (measure + auto-revert): apply leaves a sidecar row at `status='measuring'` with
  `applied_for_name`, `base_version` (the rollback target version_no in agent_skill_versions),
  `origin_location`, `is_external`, and `measure_reason='hash:<sha256-of-revised-body>'`. To roll
  back: for `is_external=0` restore the snapshotted base body to the managed SKILL.md and
  `repo.rollback(id, base_version)`; for `is_external=1` `deleteManagedSkill(name)` (removing the
  shadow restores the untouched external original byte-for-byte) + `reloadSkills()`; then set
  status `active` (kept) or `reverted` (lost). The prior body for both paths is in
  `agent_skill_versions` at `version_no = base_version`. #798 guard should assert the external
  original at `origin_location` is byte-identical before/after a full apply→revert cycle.
- Concerns: `defaultReadOriginal` reads the live `location` (a SKILL.md path) off disk to capture
  the rollback base; if a skill's content is multi-file (resources beside SKILL.md) only SKILL.md
  is snapshotted — acceptable for revert-by-shadow-delete (external) and SKILL.md-body revise
  (managed), but a multi-file managed revise would only roll back SKILL.md. No such skills today.

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
