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

### 2026-06-28 — #797 one-time idempotent backfill of legacy agent_skills rows into the unified model (skill-unify2 #791, 6/7)
- Worktree branch `worktree-agent-a1d9365090a18bebf` (based on `cb18c083e`, has #792/#793/#794/#795). NOT pushed.
- Files added/modified:
  - `apps/api_server/src/services/skill_metadata_backfill.ts` (NEW) — `backfillSkillMetadata(deps)`: reconciles HISTORICAL rows. PUBLISHED → if a live engine skill (managed SKILL.md) already exists for the name (NOCASE) JOIN ONLY (status→active, no re-materialize, no dup row); else materialize ONCE via `materializeSkill` + normalize to active. DRAFT (never-materialized) → carry over to status='active', file absent. Lifecycle-only rows (active/measuring/reverted) left untouched. Run-once guarded by a `schema_meta` marker `agent_skills_unify_backfill_v1` (mirrors `backfill_scheduled_date_v1` + the seed gate); marker written only AFTER a clean pass so a failed run retries next boot. Postgres no-op (`env.dbClient`). Never throws. Injectable deps (repo/listSkills/materialize/alreadyDone/markDone).
  - `apps/api_server/src/server.ts` — fire-and-forget `void (async()=>{ backfillSkillMetadata() })()` inside `if (env.agentExecutionEnabled)`, right after the agent-stack seed block and before the #794/#795 crash-recovery block. Non-blocking, non-fatal, run-once-guarded internally.
  - `apps/api_server/src/services/__tests__/skill_metadata_backfill.test.ts` (NEW, 7 tests) — REAL backfill against an in-memory DB (real schema_meta marker + repo + materializer file write; only engine reload faked, live-set injected): published+existing-file → joined/no-dup-file/no-dup-row/active; published+no-file → materialized once; legacy draft → active + file absent; collision (NOCASE title==engine name) → joined; re-run no-op (identical state, marker present, no reload); no row deleted + agent_skill_versions history preserved; lifecycle-only rows untouched.
- Checks run:
  - `npx vitest run skill_metadata_backfill skill_materializer agent_skills` → 76/76 PASS.
  - `npm run build` (tsc -p tsconfig.json) → exit 0 (dist/services/skill_metadata_backfill.js emitted).
  - Full `npx vitest run` → 1394 pass / 165 files (was 1387/164; +7 tests, +1 file).
  - Falsification (each reverted): disabling the run-once gate → re-run no-op test FAILS (reconciles twice); forcing `fileExists=false` (ignore the existing-file join) → join-no-dup + collision tests FAIL (re-materialize a duplicate file).
- Decisions made: the join/dup-avoidance key is the LIVE engine name set from `listSkills()` (NOCASE), matching the repo's `findByName` collation and #793's unified-read join — a name already present means a file exists, so JOIN not materialize. Marker uses the established `schema_meta` KV pattern (SQLite-local; Postgres path bootstraps separately and the backfill is a Postgres no-op anyway). Testability follows skill_materializer (redirect managed dir + fake reload) rather than a blanket isTestEnv no-op, so the real reconciliation logic runs under vitest.
- Deviations from spec: none.
- #798 (guards) should assert: (a) re-running the backfill leaves agent_skills row count + statuses + versions byte-identical (marker short-circuit); (b) NO row is ever deleted and `agent_skill_versions` history rows are preserved across the migration; (c) a published row whose name already has a managed/live SKILL.md does NOT produce a second file under the managed dir (no dup slug dir); (d) legacy draft rows end at status='active' with no SKILL.md (file-absent in the unified read); (e) no managed-dir write ever escapes `~/.config/opencode/rhythm-managed-skills`; (f) Postgres run is a no-op (no DDL/rows touched).
- Concerns: none material. The backfill only touches `status` on legacy rows and (when needed) writes a managed SKILL.md via the same materializer #778 uses; multi-file managed skills are not re-materialized when a file already exists (join-only), so no resource files are clobbered.

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
