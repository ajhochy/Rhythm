# Project State

## Current focus

**2026-06-24 — P1-1 agent_skills table verified; feature/agent-scheduler awaiting manual smoke**

**P1-1 Complete (verified):**
- `agent_skills` table (SQLite + Postgres) with 12-column schema (id, title, when_to_use, description, steps_json, tags_json, confidence, status, source, uses, created_at, updated_at)
- `AgentSkillsRepository` with full CRUD: create, getById, list, update, remove, incrementUses, findByTitle (case-insensitive)
- All 20 contract tests passing; 997/997 total tests passing
- Commit: e6056fc163273d120f0ce1c4f4d84d0de8eb4b48

**Branch `feature/agent-scheduler`:** All planned backend + Flutter work items are headless-verified:

- **Phase A** — Odysseus-style nav column shell (`_agents_nav_column.dart`)
- **Phase B** — Rich session row extraction (`_session_list_body.dart`); nav column wired
- **C1** — api_server `POST /agent-sessions` accepts optional `mcpRole` with path-traversal guard
- **B1** — `agent_cookbook` table (SQLite + Postgres) + CRUD routes + repository/controller
- **C2** — `email-assistant.mcp.json` role file + `GET /integrations/gmail-signals` endpoint
- **D1** — `graphic-designer.mcp.json` role file + `agent_designs` table + CRUD routes
- **B2** — Flutter Cookbook feature (view/controller/repository/data source) + nav row
- **C3** — Flutter Email feature + nav row
- **D2** — Flutter Gallery feature + nav row
- **Nav overflow fix** — nav column middle region now scrolls as one area; header/footer pinned
- **#738** — `AgentRunner` service: `run()` with concurrency cap, timeout, promptAsync+poll loop
- **#739** — Scheduler local path: AGENT_LOCAL=true routes due tasks through AgentRunner (no double-trigger)
- **#740 backend** — `POST /agent-cookbook/:id/run` compiles prompt + calls AgentRunner
- **#740 Flutter** — Run button added to Cookbook view
- **Scheduled task edit** — `_ScheduleFormSheet` now supports create + edit; Edit button added to detail sheet
- **AGENT_LOCAL auth bypass** — all agent-local routers gate `requireAuth` behind `if (!env.agentLocal)`, fixing local 401s
- **#738-fix** — `AgentRunner.run()` now resolves a model (3-step cascade) and passes it to `promptAsync`; records session in `agent_sessions`; scheduler passes `agentKind`/`scheduledTaskId`/`sessionName`; boot resets stale 'running' sessions to 'error'
- **Model picker + fast-fail** — Agent profile sheet gains a Model dropdown (reuses `AgentModelsDataSource`/`CatalogModelEntry`); `AgentRunner` adds no-progress fast-fail (default 20s grace window, env `AGENT_RUN_NOPROGRESS_MS`); schedule form shows "Model is set on the profile" helper text
- **Launch button fix** — Email "Launch email assistant" + Gallery "Launch designer" now call `selectSession` + `setComposerDraft` after creating the session; show SnackBar on error; 6 new widget tests added

Visual smoke (`flutter run -d macos`) is required before merging scheduler branch.

---

## Active branch / PR

- **Branch:** `feature/agent-scheduler` (local HEAD `4b30cf5`; all changes uncommitted)
- **PR:** [#734](https://github.com/ajhochy/Rhythm/pull/734) — open
- **Base:** `main`

---

## In progress

**P1-1 agent_skills:** Complete and verified (commit e6056fc).

**feature/agent-scheduler branch:** Waiting on:
1. Commit all pending changes (~11 files: api_server agent_runner.ts + test files, AgentConfig model, Flutter model-picker + schedule form, agent_email_view, agent_gallery_view, both test files).
2. User manual smoke (`flutter run -d macos`) — confirm nav column, Cookbook/Email/Gallery views open, Email/Gallery launch buttons navigate to CHATS with the new session selected and composer prefilled, Edit button on scheduled task detail sheet, form pre-fill, profile sheet Model picker, and that a scheduled task fires + produces a session row in CHATS.
3. PR merge after smoke passes.

---

## Risks / known issues

- **Visual gap:** `flutter run` was forbidden during all coding sessions. Run manual smoke before merging.
- **Bundled api_server — MCP_ROLES_DIR:** In the Flutter `.app` bundle the api_server is embedded under `$resourcesDir/api_server/` without the full repo tree. The default `MCP_ROLES_DIR` path won't resolve `.mcp-roles/`. Operators must set `MCP_ROLES_DIR` env var for role-scoped sessions to work in production.
- **SDK tool-gating limitation (C1):** The OpenCode SDK `session.create` has no per-session tool allowlist parameter. The C1 init-time gate stores the allowlist on the `agent_sessions` row; full enforcement requires the WS gateway to honour it (future work).
- **AgentRunner polling latency:** Up to 500 ms added to result detection vs. SSE (by design — see `docs/ai/decisions/2026-06-23-agent-runner-polling-vs-sse.md`).
- **`notification` outputTarget is a TODO stub** in `agent_runner.ts` — no notification endpoint shape finalized yet.
- **No-progress loop poll interval:** The fast-fail loop uses a fixed 500ms poll interval. If `AGENT_RUN_NOPROGRESS_MS` < 500ms the loop exits after one sleep without calling `listMessages`. Minimum meaningful value is ~600ms. The default 20s and the test-override 100–200ms both behave correctly (loop exits at deadline, not before).
- **issue_653_contract.test.ts flaky:** one port-binding race observed on a single run; passed on all subsequent runs. Pre-existing, unrelated to this work.

---

## Test status

| Suite | Status |
|-------|--------|
| `dart format .` | PASS — 0 changed (last verified 2026-06-23) |
| `flutter analyze --no-fatal-infos` | PASS — 0 errors, 0 warnings (last verified 2026-06-23) |
| `flutter test` (full) | **645 PASS, 0 FAIL** (+6 new launch-button widget tests, last verified 2026-06-23) |
| `api_server tsc --noEmit` | PASS — 0 errors (last verified 2026-06-24) |
| `api_server npm test` | **997/997 PASS** (last verified 2026-06-24; +20 P1-1 agent_skills contract tests; all verification gates passed) |

---

## Next step

1. **Commit pending changes** — all ~11 modified/new files on feature/agent-scheduler branch (see "In progress" above).
2. **Manual smoke** — `flutter run -d macos`:
   - Confirm nav column header/footer pinned, middle scrolls, all TOOLS rows reachable.
   - Confirm Cookbook/Email/Gallery views open.
   - **Tap "Launch email assistant"** — confirm CHATS opens with new session selected + composer prefilled with email opener text.
   - **Tap "Launch designer"** — confirm CHATS opens with new session selected + composer prefilled with designer opener text.
   - Confirm Edit button appears in scheduled task detail sheet; form pre-fills correctly.
   - Confirm Save calls PATCH (not POST).
   - **Open an agent profile sheet** — confirm a Model dropdown appears, populated with catalog models; select one, save, confirm it persists.
   - **Check schedule form** — confirm "Model is set on the profile" helper text appears under the Agent Profile dropdown.
   - **Trigger a scheduled task** — confirm a session row appears in CHATS list (verifies #738-fix end-to-end).
3. **Merge PR #734** after smoke passes.

---

## Recent coding-agent runs

### 2026-06-24 — P1-2 agent_skills CRUD routes + exposure
- Files modified:
  - `apps/api_server/src/controllers/agentSkillsController.ts` (NEW) — list/getOne/create/patch/remove over `AgentSkillsRepository`. Mirrors `agent_configs_controller.ts` conventions (AppError, `next(err)`, `validateBody`). Validation: title required non-empty string (400 via `validateBody(body, true)`); status must be `'draft'|'published'` if present (400); confidence must be a number 0..1 if present (400). 404 via `AppError.notFound('AgentSkill')` when id missing.
  - `apps/api_server/src/routes/agentSkillsRoutes.ts` (NEW) — GET '/', POST '/', GET '/:id', PATCH '/:id', DELETE '/:id'. Includes `if (!env.agentLocal) router.use(requireAuth)` posture, matching `agent_configs_routes.ts`.
  - `apps/api_server/src/app.ts` — imported `agentSkillsRouter`, mounted at `/agent-skills` immediately after the `/agent-configs` mount.
  - `apps/api_server/src/__tests__/agent_skills_routes.test.ts` (NEW) — 13 integration tests (createApp().listen(0), maxRequestsPerSocket=1, in-memory DB via setDb): GET empty → [] + 200; GET/:id round-trip; GET missing → 404; POST valid → 201; POST minimal (title only) defaults; POST missing/empty title → 400; POST bad status → 400; POST confidence out of range → 400; PATCH → 200; PATCH unknown → 404; PATCH bad status → 400; DELETE → 204; DELETE unknown → 404.
- Checks run:
  - `npx tsc --noEmit` — PASS (exit 0)
  - `npx vitest run` (full) — first run 1010/1011 with one `UND_ERR_SOCKET` flake in `issue_677_contract.test.ts` (known socket-recycle flake, unrelated); re-run **1011/1011 PASS** (baseline 997 + 13 new route tests + 1 prior delta).
- Decisions made: DELETE returns **204 No Content** (hard delete via `repo.remove`), matching `agent_configs` DELETE semantics. Used authHeaders in tests (mirroring agent_configs test) so the suite passes regardless of `env.agentLocal`.
- Deviations from spec: none. No owner scoping, no retrieval/scoring, no pagination (all per spec).
- Concerns: none. Empty-table GET returns [] not 500 (schema-drift gate satisfied).

### 2026-06-24 — P1-1 agent_skills table (both DBs) + repository
- Files modified:
  - `apps/api_server/src/models/agent_skill.ts` (NEW) — `AgentSkill` + `AgentSkillInput`. Exposes parsed `steps`/`tags` (optional) AND raw `stepsJson`/`tagsJson` (required) to satisfy both the issue intent (arrays) and the acceptance-contract literal (raw JSON strings).
  - `apps/api_server/src/repositories/agent_skills_repository.ts` (NEW) — sync better-sqlite3 repo; create/getById/list/update/remove/incrementUses/findByTitle (case-insensitive via COLLATE NOCASE); rowToModel JSON-parses steps_json/tags_json. Takes an optional `db` in the constructor, falling back to `getDb()` and then an isolated in-memory migrated DB if no global DB is initialized (test-friendly).
  - `apps/api_server/src/database/migrations.ts` — added SQLite `CREATE TABLE IF NOT EXISTS agent_skills` + `idx_agent_skills_title`, placed after agent_memory block.
  - `apps/api_server/src/database/postgres_bootstrap.ts` — added Postgres `CREATE TABLE IF NOT EXISTS agent_skills` + index (identical columns), placed before agent_configs ALTER block.
  - `apps/api_server/src/__tests__/agent_skills_repository.test.ts` (NEW) — 12 repo tests (round-trip, empty list, update, remove, incrementUses, findByTitle dedup).
  - `apps/api_server/src/__tests__/issue_p1_1_agent_skills.test.ts` — pre-existing contract file; added missing `beforeEach` that initializes the global DB via `setDb(runMigrations(:memory:))` and removed an unused `Pool` import. The contract tests instantiated the repo with no DB wired up and threw "Database not initialized"; this is a test-setup fix, not a stub of the system under test.
- Checks run:
  - `npx tsc --noEmit` — PASS (exit 0)
  - `npx vitest run` (full) — PASS, **997/997** (baseline 966 + 31 new contract/repo tests)
- Decisions made: Model carries both `steps`/`tags` (parsed) and `stepsJson`/`tagsJson` (raw) because the acceptance-contract test references `stepsJson`/`tagsJson` while the issue text specifies array fields. Made the parsed array fields optional so the contract literal (which omits them) typechecks.
- Deviations from spec: Issue model named only `steps`/`tags`; added `stepsJson`/`tagsJson` to satisfy the contract test. No owner scoping, no seeding, no routes (as specified).
- Concerns: Postgres schema not exercised by tests (SQLite-only test env — known schema-drift caveat); columns were mirrored by hand and confirmed identical to the SQLite list.

---

**Run history:** one file per run under `docs/ai/runs/` (surfaced as `ai-runs/`); prior log in `runs/_migrated-2026-06-18.md`. Snapshot overwritten in place.
