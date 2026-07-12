# Plan — Issue #929: Simple self-regulating harvested skill loop

Branch: TBD (off `main`). Planning only — no code here.

## What already exists (do NOT rebuild)

The self-improvement machinery for **refined** skills is largely built; #929 is
mostly about routing **harvested (extracted)** skills through the same machinery
instead of leaving them as invisible drafts.

- **Harvester**: `services/skill_extractor.ts` — `distillFromSession` writes a
  row with `status: 'draft'`, `source: 'auto-extract'`. Fire-and-forget via
  `queueSkillExtraction`. Never throws; no-op under test/Postgres.
- **Schema** (`database/migrations.ts` ~1285): `agent_skills` already has
  `status`, `uses`, `confidence`, `source`, `version`, `applied_for_name`,
  `baseline_score`, `post_score`, `measure_reason`. `agent_skill_versions` gives
  rollback. **Likely no new columns needed.**
- **Materializer**: `services/skill_materializer.ts` — `materializeSkill` writes
  a SKILL.md into the managed dir so the engine/picker/allowlist see it. **Today
  it only runs on `status === 'published'`** (agentSkillsController create/update).
- **Measurement/revert**: `services/skill_measurement.ts` — measures a
  `measuring` row (LLM-judge baseline vs post), KEEP→`active` or REVERT→`reverted`.
  Built for the *refiner* path; keyed on `applied_for_name` + `base_version`.
- **Uses tracking**: `repo.incrementUses(id)` is already called from
  `skill_retrieval.ts` / `ws_gateway.ts` / `agent_runner.ts`.
- **Skills UI**: `apps/desktop_flutter/lib/features/agent_skills/views/agent_skills_view.dart`
  already lists engine skills (`GET /opencode/skills`) with **Status, Score,
  Usage** columns and **edit/delete** actions. Status/uses come from the #792
  **sidecar joined to a live engine skill BY NAME** (`routes/opencode_skills_routes.ts`).

### The core gap
A harvested draft is never materialized → no managed SKILL.md → not in the
picker, not allowlist-scopable, and **invisible in the Skills UI** (which lists
live engine skills, joined to sidecar by name). Worse, the retrieval `uses` bump
is by draft **id**, but the UI's `uses` reads the sidecar row joined by **name**,
so even usage never surfaces for a draft. The "review panel" the issue wants to
avoid does not actually exist — the real fix is: materialize on harvest, then let
uses/measurement decide its fate.

---

## Units (sequential)

### Unit 1 — Materialize harvested skills so they are immediately usable
- **Goal**: When the harvester creates a skill, it appears in the engine picker
  and Skills UI right away (no `published` gate for auto-extract), so acceptance
  "newly harvested skills are materialized/usable" is met.
- **Approach (lazy)**: In `distillFromSession`, after `repo.create(...)`, call
  `materializeSkill(created)` (fire-and-forget, already never-throws). Keep
  `status` as-is but ensure the row is discoverable. Confirm the sidecar join in
  `opencode_skills_routes.ts` surfaces auto-extract rows (they must have a
  managed SKILL.md whose `name` == title for the by-name join to light up
  status/uses in the UI).
- **Likely files**: `services/skill_extractor.ts`; verify
  `routes/opencode_skills_routes.ts` join; maybe `controllers/agentSkillsController.ts`
  (`VALID_STATUSES`) if a new status value is introduced.
- **Acceptance**: harvested skill has a managed SKILL.md; `GET /opencode/skills`
  returns it; UI lists it with a status pill.
- **Depends on**: none.
- **Risk**: MEDIUM. Behavior change touching **live harvester runs** — every
  qualifying session now writes a real, model-visible skill. No schema change.
  Main risk is low-quality skills going live before evaluation (Units 2–3 gate
  this) — see OQ-1/OQ-2.

### Unit 2 — Track per-skill run count + last outcome for harvested skills
- **Goal**: Acceptance "run count/outcome tracked per skill". Ensure a harvested
  skill's `uses` increments when the agent actually uses it, and record a
  last-outcome signal.
- **Approach**: Fix the id-vs-name mismatch so the `incrementUses` bump lands on
  the row the UI reads (join by name is the UI's source of truth). Reuse
  `uses` + `measure_reason`/`post_score` for "last outcome" rather than adding
  columns.
- **Likely files**: `services/skill_retrieval.ts`, `services/ws_gateway.ts`,
  `services/agent_runner.ts`, `repositories/agent_skills_repository.ts`.
- **Acceptance**: using a harvested skill bumps the count shown in the UI Usage
  column; a per-skill outcome value is persisted and readable.
- **Depends on**: Unit 1 (skill must be materialized/joinable first).
- **Risk**: LOW–MEDIUM. No schema change if `uses`/existing columns suffice
  (see OQ-3). Touches live run paths — keep bumps best-effort/never-throw.

### Unit 3 — Evaluate a harvested skill after N uses; keep / disable / rewrite
- **Goal**: Acceptance "skills evaluated after 2-3 uses" and "bad skills
  disabled/rewritten". After the threshold, run the existing judge
  (`scoreSkillBody`) / reuse the measurement decision to KEEP (`active`),
  DISABLE (dematerialize + `status` marker), or flag REWRITE (hand to
  `skill_refiner.refineExistingSkill`).
- **Approach**: Add a small evaluator that, when `uses >= threshold` for an
  auto-extract skill, scores it and transitions status. Reuse
  `skill_measurement`/`skill_refiner` rather than a new scorer. Disable =
  `dematerializeSkill` + a terminal status; rewrite = refiner in place.
- **Likely files**: new `services/harvested_skill_evaluator.ts` (or extend
  `skill_measurement.ts`); wire the trigger next to `incrementUses`.
- **Acceptance**: a skill crossing the threshold gets a keep/disable/rewrite
  decision persisted; disabled skills leave the picker.
- **Depends on**: Units 1 & 2.
- **Risk**: MEDIUM. Behavior change; auto-disable/auto-rewrite of live skills.
  Needs the threshold + keep-criteria decisions (OQ-1, OQ-2).

### Unit 4 — Harvester-quality signal on repeated bad harvests
- **Goal**: Acceptance "repeated bad harvests create/focus harvester-fix
  signal". If auto-extract skills are disabled/reverted at a bad rate (issue
  suggests 3-in-a-row or 5-of-last-10), emit a signal to fix the harvester.
- **Approach (lazy)**: Query the last N auto-extract rows' terminal outcomes; if
  the bad-rate trips, write ONE org-optimizer / workflow-failure signal (reuse
  the existing signal path — the branch name and repo already have a
  `workflow_failure_signal_extractor` + `org_optimizer_run_service`). Do NOT
  build a new dashboard.
- **Likely files**: reuse `services/org_optimizer_run_service.ts` or the
  workflow-failure signal path; a small query in the evaluator from Unit 3.
- **Acceptance**: after a tripping sequence, exactly one harvester-quality signal
  is created/focused; it de-dupes rather than spamming.
- **Depends on**: Unit 3 (needs terminal outcomes to count).
- **Risk**: LOW–MEDIUM. Additive signal. Needs the exact thresholds (OQ-1) and
  which signal channel (OQ-4).

### Unit 5 — Minimal Skills-UI status surface (verify / small polish only)
- **Goal**: Acceptance "existing Skills page shows minimal status" and
  disable/delete action. Largely **already done** — the view has Status, Score,
  Usage columns + edit/delete.
- **Approach**: Verify harvested skills render correctly (status pill values from
  Units 1/3 map to `_statusRank`/pill rendering); add a "disable" affordance if
  delete is not the desired soft action; ensure new status strings
  (`disabled`/`rewrite-needed`?) are handled in `_statusOf`/`_statusRank`.
- **Likely files**: `apps/desktop_flutter/lib/features/agent_skills/views/agent_skills_view.dart`,
  `.../controllers/agent_skills_controller.dart`; possibly `opencode_skills_routes.ts`
  status enum + `agentSkillsController.ts` `VALID_STATUSES`.
- **Acceptance**: harvested skills visible with status + run count; a
  disable/delete action works from the page.
- **Depends on**: Units 1 & 3 (final status vocabulary).
- **Risk**: LOW. UI change only; run `dart format` + `flutter analyze`.

---

## Open questions (need a product decision — do NOT guess)

- **OQ-1 (thresholds)**: Confirm exact numbers — evaluate after 2 or 3 uses?
  Bad-harvest trip = "3 bad in a row" AND/OR "5 bad of last 10"? These drive
  Units 3 & 4.
- **OQ-2 (keep criteria)**: What counts as "it helped"? The existing measurement
  uses an LLM-judge `post_score > baseline_score`. For a *harvested* skill there
  is no prior body to beat — so keep-criteria must be defined differently
  (absolute judge score? error-free usage? no user thumbs-down?). This is the
  biggest ambiguity and blocks Unit 3.
- **OQ-3 ("last outcome" storage)**: Reuse `measure_reason`/`post_score`, or add
  a dedicated `last_outcome`/`eval_count` column? Adding a column = a Postgres
  backfill per the schema-drift note (agent data is SQLite-only, so likely fine,
  but confirm). Prefer reusing existing columns.
- **OQ-4 (harvester-fix signal channel)**: Which existing signal — org-optimizer
  proposal, workflow-failure signal, or a GitHub issue via the AI workflow? The
  current branch already touches `workflow_failure_signal_extractor` /
  `org_optimizer` — reuse one of those.
- **OQ-5 (materialize-then-measure vs. gate-before-materialize)**: The issue says
  make harvested skills usable *immediately* (Unit 1), then self-regulate. That
  means low-quality skills are briefly live before Unit 3 disables them.
  Acceptable, or should there be a lightweight pre-materialization confidence
  gate (e.g. reuse `MIN_CONFIDENCE`/`DRAFT_CONFIDENCE_GATE`) so only decent
  drafts go live? Recommend: materialize immediately but only above the existing
  `DRAFT_CONFIDENCE_GATE`, to bound blast radius.

## Notes
- Everything stays local-SQLite-only (Postgres no-ops) and never-throws,
  matching the existing extractor/measurement operational envelope.
- Prefer reusing `skill_materializer`, `skill_measurement`, `skill_refiner`, and
  the existing UI columns over new services/panels — the issue explicitly wants
  "no new control panel".
