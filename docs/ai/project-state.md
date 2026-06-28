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

**2026-06-28 — #785 added the MCP analogue of the #777 skill guards.** A vitest
`mcp_names_alignment.test.ts` + a real-binary `smoke_mcp_alignment.sh` (wired into
`desktop_release.yml`) now enforce two invariants for MCP: (1) names alignment —
every name in a persisted/derived `allowed_mcps_json` exists in the live
`GET /opencode/mcp` id set (the #781 hazard: `ableton` vs `ableton-mcp`); (2)
no-server-lost — the GET /opencode/mcp enrichment mapping is additive (ids OUT ==
ids IN). The guard *detects* MCP-scope drift; #789 still owns *building* the
agent_profile_sync reconciliation that intersects `allowed_mcps_json` with the
live set (the MCP path currently writes a static `["rhythm"]`, unlike the skill
path's Unify-3 intersection). See
`docs/ai/runs/2026-06-28-issue-785-mcp-names-alignment.md`.

## Active branch / PR

- **Branch:** `feature/unify-skills-source-of-truth` (stacked off
  `fix/issue-775-skill-allowlist-guard`). PR about to open against `main`; **do
  not merge** — human review + manual smoke first.
- **#775 / PR #776** remains open (smoke PASSED, ready for human merge). Merge
  #776 first or merge this PR after it, since this branch contains #775's commits.
- Ships only after a **fork rebuild + signed release** (the fork binary is
  bundled; release CI rebuilds it).
- **#785** committed on worktree branch `worktree-agent-a8e47e60d1bc0fe28`
  (off `feature/mcp-unify`), commit `854216ed6` — test+CI-only, PR not yet opened.

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
- **#785:** `mcp_names_alignment.test.ts` **5 pass** + 4 related files (37 pass
  total); `tsc --noEmit` 0 errors; `smoke_mcp_alignment.sh` `bash -n` OK (wired
  into `desktop_release.yml`; real-binary serve runs only in release CI).

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

## Recent coding-agent runs

### 2026-06-28 — #786 GET /opencode/mcp provenance flag (worktree off feature/mcp-unify)
- Files modified:
  - `apps/api_server/src/routes/opencode_mcp_routes.ts` — added a derived
    `source: 'curated' | 'rhythm' | 'adhoc'` field to each GET /opencode/mcp
    entry (computed from the live status-map key × CURATED_MCP_SERVERS via the
    existing `findCuratedServer`; `'rhythm'` for the brokered rhythm key).
  - `apps/api_server/src/__tests__/opc_m4_3_mcp_routes.test.ts` — new
    `issue-786` describe block (2 tests): curated-by-id / rhythm / adhoc + `foo`
    classification with a no-server-lost set assertion; curated-by-name match.
- Checks run:
  - `vitest run opc_m4_3_mcp_routes.test.ts` → 19/19 pass (was 17, +2 new).
  - Falsification: removing the `source` field → 2 fail; restored.
  - `npm run build` (tsc) → exit 0.
- Decisions made: chose the three-way split over `curated: boolean` because the
  rhythm MCP is unambiguously identifiable by its stable `'rhythm'` key, so the
  extra precision is free. Flag is derived from the live list, never a second
  display source.
- Deviations from spec: none.
- Concerns: none. Flutter parse of the new field is the out-of-scope #788/#789
  follow-up. node_modules in this worktree is a symlink to the main checkout
  (not committed).

## Next step

MCP-unify Phase 1 (#785/#786/#787) integrated on `feature/mcp-unify`; Phase 2
(#789 then #788) next, then verification-gate + PR. (Snapshot rewritten by
project-state-updater after verification.)

## Recent coding-agent runs

### 2026-06-28 — #787 curated MCP catalog as install-template layer (branch off `feature/mcp-unify`)
- Files modified:
  - `apps/api_server/src/config/curated_mcp_servers.ts` — header contract only
    (engine = source of truth; catalog = template+enrichment that
    materializes-on-install via `ensureCuratedMcps`; replaced the misleading
    "source-of-truth list" wording). No server definitions changed.
  - `apps/api_server/src/__tests__/curated_mcp_no_display.test.ts` — new guard
    (g1 GET /opencode/mcp lists the live engine not the catalog; g2
    ensureCuratedMcps idempotent + skips token-bridged w/o account; g3 static —
    route never ships the bare catalog).
  - `docs/ai/decisions/2026-06-28-unify-mcp-source-of-truth.md` — new decision
    (mirrors the skills decision; refs #783/#781/#765).
- Checks run: `tsc -p tsconfig.json` exit 0; `vitest run` new file 7/7 pass;
  new + 3 existing curated-MCP suites 35/35 pass. Falsification: injecting
  `res.json(CURATED_MCP_SERVERS)` into GET / failed 4/7 assertions (restored).
- Decisions made: documentation + enforcement of the already-correct
  architecture; no behavioral change. See decision doc.
- Deviations from spec: none.
- Concerns: none. The catalog had no display consumer to begin with; this run
  only documents + guards that boundary. (Issue references #783 in the doc —
  the issue prompt cited #783/#781/#765; #783 used as the catalog/display
  tracking ref.)

### 2026-06-28 — #788 validate agent_profile_sync MCP defaults vs live ids; document auto-installers (worktree off `feature/mcp-unify`)
- Files modified:
  - `apps/api_server/src/services/agent_profile_sync.ts` — added
    `validateMcpsAgainstLive()` (mirrors the skill-side `filterAllowlistToLive`)
    + a try/catch `liveMcpNames` fetch (`listMcp()` keys); both the insert and
    backfill sites now validate the importer default `["rhythm"]` against the
    live engine id set. A dead name is dropped + logged loudly (never persisted
    as #765 scope); empty/unavailable live set → default unchanged, never throws.
  - `apps/api_server/src/services/__tests__/agent_profile_sync_mcp_alignment.test.ts`
    — new (4 tests): default persisted when live, dead name dropped+warned, two
    boundary cases (listMcp throws / returns {} → default `["rhythm"]` preserved).
  - `apps/desktop_flutter/lib/app/core/agents/curated_mcp_auto_installer.dart`,
    `rhythm_mcp_auto_installer.dart` — header doc comment (materialize-on-install
    trigger; live engine = source of truth; KEEP). Behavior unchanged.
  - `docs/ai/decisions/2026-06-28-unify-mcp-source-of-truth.md` — addendum
    recording the auto-installer KEEP decision + rationale + the MCP-default
    validation.
- Checks run:
  - `vitest run agent_profile_sync` → 4 files / 32 tests pass.
  - Falsification: reverting the insert-site validation to the raw constant →
    the dead-name test fails (`expected '["rhythm"]' to be null`); restored.
  - `vitest run mcp_names_alignment curated_mcp_no_display` (#785/#787 guards) →
    12/12 pass (no regression).
  - `npm run build` (tsc) → exit 0.
  - `flutter analyze --no-fatal-infos` on the two edited files → 0 issues
    (pre-existing `ansi_strip.dart` info from PR #552 is unrelated/out of scope).
- Decisions made: implemented self-contained (NOT reusing a #789 helper) — #789
  (`mcp_name_alignment.ts` / `normalizeDerivedAllowedMcps`) does **not** exist on
  `feature/mcp-unify` yet, contrary to the dispatch framing; the validator mirrors
  the existing skill-alignment pattern so #789 can later refactor both onto one
  helper without changing behavior. Auto-installer fate = KEEP (see decision doc).
- Deviations from spec: dispatch prompt assumed #789 was already merged here; it
  was not (verified: helper absent on `feature/mcp-unify`). Built the validation
  directly rather than reusing a non-existent helper. No user `allowed_mcps_json`
  rows rewritten; no DB columns; no OAuth/#765 changes.
- Concerns: when #789 lands its `mcp_name_alignment.ts`, fold `validateMcpsAgainstLive`
  + the skill `filterAllowlistToLive` onto the shared helper (alias normalization,
  e.g. `ableton`→`ableton-mcp`, is a #789 concern — this run only validates exact
  live-id membership). node_modules here is a symlink to the main checkout (not
  committed).
