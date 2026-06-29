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

### 2026-06-28 — #805 memory injection reads derived index + startup rebuild (memory epic #801, issue 4/7)
- Branch: `worktree-agent-ade04b460b975c257` (based on `origin/feature/mem-vault`).
- Files modified:
  - `apps/api_server/src/services/memory_retrieval.ts` — added `notePaths: (string|null)[]`
    to `MemoryPreface` (AC6: each match's vault note path = its index-row `sourceId`,
    positionally aligned with `memoryIds`); documented that retrieval reads through the
    DERIVED SQLite index (never a per-prompt vault scan), so injection works Obsidian-closed.
    No change to tokenization/top-N(5)/`AGENT_MEMORY_INJECTION_ENABLED`.
  - `apps/api_server/src/server.ts` — agent-execution startup now calls
    `new MemoryIndexService().rebuildIndexFromVault()` ONCE (non-fatal, before the cron job)
    so a fresh boot has a correct index without waiting for the first */10min tick.
  - `apps/api_server/src/__tests__/memory_injection_index.test.ts` (new) — 9 tests:
    write→recall (AC1), index-only recall with vault deleted off disk (AC1/AC2 Obsidian-closed),
    note path present (AC6), on-disk edit reflected after re-index (AC3), deletion after
    re-index (AC4), toggle-off (AC5), + 2 falsification guards.
- Checks run:
  - `cd apps/api_server && npx vitest run memory_injection_index memory_injection
    memory_index_rebuild memory_write_vault_first` → 45/45 PASS (new file 9/9; existing
    `memory_injection*` unchanged-green).
    Falsification: gutting `notePaths` population → AC6 test FAILS; skipping the
    `syncMemoryVault` re-index in the edit test → AC3 test FAILS; both restored → green.
  - `npm run build` (tsc) → exit 0.
- Decisions made: injection already read the index (`searchAsync` over SQLite `agent_memory`),
  so the substantive #805 deltas were note-path exposure + the startup rebuild. The cron's
  `syncMemoryVault` (upsert+tombstone) is the re-index pass that carries user edits/deletions
  into injection — no new watch added (cron suffices for the AC; optional watch deferred to
  keep the change minimal and avoid rebuild-storm risk). agent_runner/ws_gateway untouched
  (they only read `.text`/`.memoryIds.length`; a parallel skills branch also edits agent_runner).
- Deviations from spec: filesystem watch omitted (issue marks it optional; cron covers AC3/AC4).
- Concerns: worktree `node_modules` is a symlink to the main checkout and shows as untracked
  (gitignore patterns are dir-only) — staged only the 3 intended files, symlink NOT committed.

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

### 2026-06-28 — #803 vault-first write path for `remember` (memory epic #801, issue 2/7)
- Branch: `feat/issue-803-vault-first-remember` (off `feature/mem-vault`).
- Files modified:
  - `apps/api_server/src/services/memoryVaultWriteService.ts` (new) — owns the
    vault-first write path: `rememberToVault()` (dedup → write note FIRST →
    `MemoryIndexService.upsertNote`), `forgetFromVault()` (confined unlink),
    plus `generateUlid` / `normalizeContentKey` / `slugForNote` / `renderMemoryNote`
    helpers + `MemoryWriteError`. Path-traversal guard `resolveWithinMemoryDir`.
  - `apps/api_server/src/services/agentMemoryService.ts` — `remember` now delegates
    to `rememberToVault` (signature `RememberInput` → `RememberResult`); `forget`
    looks up the row by id, deletes the vault file for `obsidian-memory` rows, then
    drops the index row.
  - `apps/api_server/src/controllers/agentMemoryController.ts` — `create` passes
    `{kind, content, id, source, tags}`, returns `{id, path, kind}`, maps
    `MemoryWriteError` → 400. (No `sourceId` passthrough — the index source_id is the
    vault path now.)
  - `apps/api_server/src/config/env.ts` — added `resolveMemoryDirPath()` =
    `<MEMORY_VAULT_PATH>/memory` (the write-path boundary).
  - `apps/api_server/src/__tests__/memory_write_vault_first.test.ts` (new) — 13 tests:
    AC1 frontmatter+body, AC2 sync search, AC3 dedup-by-id + dedup-by-content,
    AC4 invalid kind + empty content, AC5 path-escape, AC6 delete file+row + safe
    404, helper unit tests, and a vault-first falsification guard.
- Checks run:
  - `npx vitest run memory_write_vault_first memory_index_rebuild memory_vault_sync`
    → PASS (34/34; new file 13/13).
  - Falsification: flipping to index-first ordering → the falsification guard FAILS
    (index row survives a failed FS write: 1 failed / 12 passed); restored → green.
  - `npm run build` (tsc) → exit 0.
  - `npx vitest run agent_memory memory_injection memory_vault_sync_route` → 17/17
    (no regression in adjacent memory suites).
- Decisions made: layout is folders-by-type `memory/<kind>/<slug>.md`; dedup keys on
  frontmatter `id` first, normalized-content slug as fallback (preserves id+created,
  bumps updated). ULID is a dependency-free Crockford-base32 generator (no `ulid`
  package in deps; adding one for one id source is unwarranted). The memory dir is the
  `<MEMORY_VAULT_PATH>/memory` subtree — distinct from the whole vault — and is the
  single path-traversal boundary.
- Deviations from spec: none. (Note: `id` accepted as-is even if non-ULID and used as
  the dedup key; a fresh ULID is assigned only when absent.)
- Concerns: the dedup-by-content slug truncates to 60 chars, so two DIFFERENT long
  contents sharing a 60-char prefix would collide onto one note — acceptable for the
  current memory sizes but worth a content-hash suffix if collisions appear.

### 2026-06-28 — #804 re-route memory MCP tools to local agent server :4001 (memory epic #801, issue 3/7)
- Branch: `worktree-agent-a8292be007c419d9b` (off `feature/mem-vault`).
- Topology bug fixed: memory MCP tools were registered with `RHYTHM_API_URL`
  (= prod Settings URL), so agent memories wrote to prod Postgres while the
  Flutter memory UI reads `AppConstants.agentLocalBaseUrl` (:4001) — they
  disagreed. Now the tools point at the LOCAL agent server, like
  `notifications`/`agentDelegation` already do.
- Files modified:
  - `apps/mcp_server/src/index.ts` — `registerAgentMemoryTools` now passed
    `RHYTHM_AGENT_URL` (default http://localhost:4001) instead of `RHYTHM_API_URL`.
  - `apps/mcp_server/src/tools/agentMemory.ts` — docstring/comment only; all 4
    tools already use the injected `apiUrl` base, now the local agent base.
  - `apps/desktop_flutter/lib/features/settings/views/settings_view.dart` — the
    manual MCP config snippet now also sets `"RHYTHM_AGENT_URL":
    "http://localhost:4001"` (hard-coded, NOT `serverConfig.url`). Single-line
    string-literal edit; no structural/format change.
  - `apps/api_server/src/services/opencode_client_service.ts` — `ensureRhythmMcp`
    writes `RHYTHM_AGENT_URL` (env-overridable, default localhost:4001) into the
    opencode.json env alongside `RHYTHM_API_URL`/`RHYTHM_API_TOKEN`.
  - `apps/mcp_server/src/tools/__tests__/agentMemory_local_base.test.ts` (new) —
    5 tests: all 4 tools resolve to :4001 (stubbed global fetch captures URL);
    prod-URL-env change is inert.
  - `apps/api_server/src/__tests__/opc_rhythm_mcp_ensure.test.ts` — `DESIRED`
    env now includes `RHYTHM_AGENT_URL`; added an assertion + a new test that the
    agent base stays :4001 even when the prod `apiUrl` differs.
- Checks run:
  - `cd apps/mcp_server && npx vitest run` → 52/52 PASS (new file 5/5).
    Falsification: building the tools with a prod base → all 5 new tests FAIL
    (e.g. `expected 'https://api.vcrcapps.com/agent-memory' to be
    'http://localhost:4001/agent-memory'`); restored → green.
  - `cd apps/mcp_server && npm run typecheck` → exit 0.
  - `cd apps/api_server && npx vitest run opc_rhythm_mcp_ensure` → 6/6 PASS;
    `npm run build` (tsc) → exit 0; adjacent memory suites
    (`agent_memory memory_injection memory_write_vault_first memory_index_rebuild`)
    → 36/36, no regression.
  - Flutter: `dart format` left settings_view structurally unchanged (single
    string-literal line); `flutter analyze --no-fatal-infos lib/features/settings/`
    → 11 pre-existing info-level only, 0 errors/warnings, none on the changed line.
- Decisions made: kept `RHYTHM_API_URL` for non-memory tools that legitimately hit
  prod — only the memory tools' base moved. The agent base is env-overridable
  (`RHYTHM_AGENT_URL`) but defaults to localhost:4001, matching the Flutter
  `AppConstants.agentLocalBaseUrl` and the existing `notifications`/`agentDelegation`
  convention. The Flutter snippet hard-codes :4001 (not `serverConfig.url`) so a prod
  URL change can never move it.
- Deviations from spec: none.
- #807 note (remove-prod-store + repo-scan): the prod Postgres `agent_memory` table
  is still created in `apps/api_server/src/database/postgres_bootstrap.ts` (L544-559,
  table + 2 indexes), and the prod server still mounts the `/agent-memory` router via
  `apps/api_server/src/app.ts` (L123). No live writer targets prod anymore (the MCP
  tools and the Flutter UI both use :4001), so those are the remaining prod-store
  references for #807 to remove. Migrations/repository (`migrations.ts`,
  `agent_memory_repository.ts`) already treat the SQLite table as a disposable
  vault-derived index (#802); the Postgres bootstrap is the unmigrated prod remnant.
- Concerns: the memory tools rely on the global `fetch` (no injected fetch param), so
  the new tests stub `globalThis.fetch` rather than passing a mock — consistent with
  `api_client.ts` using the global. If a fetch-injection is added later (as
  `agentDelegation` has), the tests should switch to it.
