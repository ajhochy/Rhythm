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

### 2026-06-28 — #802 MemoryIndexService (memory epic #801, issue 1/7)
- Files modified:
  - `apps/api_server/src/services/memory_index_service.ts` (new) — `MemoryIndexService`
    owning the derived index: `rebuildIndexFromVault(vaultPath?)` (clear + repopulate
    from full vault scan), `upsertNote()` / `removeNote()` incremental ops for #803.
  - `apps/api_server/src/services/memoryVaultSyncService.ts` — extracted the recursive
    vault walk + parse into an exported `scanVaultNotes()` helper (+`ScannedNote`);
    `syncMemoryVault` now reuses it (no duplicated scan/parse). `parseNote` was already
    exported, reused directly.
  - `apps/api_server/src/repositories/agent_memory_repository.ts` — added
    `clearAllAsync()` (SQLite-only wipe + FTS 'delete-all'; Postgres no-op returns 0).
  - `apps/api_server/src/database/migrations.ts` — comment-only: marks SQLite
    agent_memory/agent_memory_fts as DERIVED/DISPOSABLE. No DDL change.
  - `apps/api_server/src/__tests__/memory_index_rebuild.test.ts` (new) — 8 tests
    covering AC1 count/fields, AC2 idempotence, AC3 clear+rebuild reproduces
    searchAsync top-N, AC4 missing+empty vault no-op, stale-row drop, upsert/remove.
- Checks run:
  - `npx vitest run memory_index_rebuild memory_vault_sync` → PASS (21/21; new file 8/8).
  - Falsification: stubbing the clear step in rebuild → "rebuild drops stale rows"
    test FAILS (1 failed / 7 passed); restored → green.
  - `npm run build` (tsc) → exit 0.
- Decisions made: extracted `scanVaultNotes` rather than duplicating the walk so the
  rebuild and mirror-sync share one parse path (issue mandated reusing `parseNote`).
  `clearAllAsync` is SQLite-scoped — the disposable index is SQLite-only; Postgres
  agent_memory is never cleared by this path (postgres_bootstrap.ts untouched).
- Deviations from spec: none.
- Concerns: decision doc `2026-06-28-memory-vault-as-source-of-truth.md` lives on
  branch `docs/memory-vault-plan`/PR #809, not on this main base — code references it
  by name; will resolve once that PR merges. #803 builds the vault-first write path
  on `upsertNote`/`removeNote`.
