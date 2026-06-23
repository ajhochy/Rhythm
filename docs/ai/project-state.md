# Project State

## Current focus

**2026-06-23 — #738/#739/#740 backend complete; full feature/agent-scheduler branch ready for PR**

Branch `feature/agent-scheduler`. All planned backend + Flutter work items are headless-verified:

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

Visual smoke (`flutter run -d macos`) is required before merging.

---

## Active branch / PR

- **Branch:** `feature/agent-scheduler` (pushed; HEAD `4e6f203`)
- **PR:** [#734](https://github.com/ajhochy/Rhythm/pull/734) — open, CI running
- **Base:** `main`

---

## In progress

Nothing actively in flight. Waiting on:
1. User manual smoke (`flutter run -d macos`) to confirm visual fidelity of the full nav column (CHATS body, TOOLS section, short-window scroll).
2. PR merge after smoke passes.

---

## Risks / known issues

- **Visual gap:** `flutter run` was forbidden during all coding sessions. Run manual smoke before merging.
- **Bundled api_server — MCP_ROLES_DIR:** In the Flutter `.app` bundle the api_server is embedded under `$resourcesDir/api_server/` without the full repo tree. The default `MCP_ROLES_DIR` path won't resolve `.mcp-roles/`. Operators must set `MCP_ROLES_DIR` env var for role-scoped sessions to work in production.
- **SDK tool-gating limitation (C1):** The OpenCode SDK `session.create` has no per-session tool allowlist parameter. The C1 init-time gate stores the allowlist on the `agent_sessions` row; full enforcement requires the WS gateway to honour it (future work).
- **AgentRunner polling latency:** Up to 500 ms added to result detection vs. SSE (by design — see `docs/ai/decisions/2026-06-23-agent-runner-polling-vs-sse.md`).
- **`notification` outputTarget is a TODO stub** in `agent_runner.ts` — no notification endpoint shape finalized yet.
- **Flutter "Run" button for cookbook (#740 Flutter)** — DONE (headless-verified 2026-06-23). Visual smoke still needed before merge.

---

## Test status

| Suite | Status |
|-------|--------|
| `dart format .` | PASS — 0 changed (last verified 2026-06-23) |
| `flutter analyze --no-fatal-infos` | PASS — 0 errors, 0 warnings (last verified 2026-06-23) |
| `flutter test` (full) | 633 PASS, 0 FAIL (+1 new cookbook run test, last verified 2026-06-23) |
| `api_server tsc --noEmit` | PASS — 0 errors |
| `api_server npm test` | 951/951 PASS (111 test files; +15 new from #738/#739/#740) |

---

## Next step

1. **Manual smoke** — `flutter run -d macos`: confirm nav column header/footer pinned, middle scrolls, all TOOLS rows reachable, search filter works, Cookbook/Email/Gallery views open.
2. **Merge PR #734** after smoke passes.
3. **#740 Flutter** — DONE. Run button added to Cookbook view.

---

**Run history:** one file per run under `docs/ai/runs/` (surfaced as `ai-runs/`); prior log in `runs/_migrated-2026-06-18.md`. Snapshot overwritten in place.

---

## Recent coding-agent runs

### 2026-06-23 — #740-flutter-cookbook-run-button
- Files modified:
  - `lib/features/agent_cookbook/data/agent_cookbook_data_source.dart` — added `runRecipe(id)` → POST `/agent-cookbook/$id/run`, parses `sessionId`
  - `lib/features/agent_cookbook/repositories/agent_cookbook_repository.dart` — exposed `runRecipe(id)` pass-through
  - `lib/features/agent_cookbook/controllers/agent_cookbook_controller.dart` — added `runRecipe(id)` returning `String?` (null on error), stores error state
  - `lib/features/agent_cookbook/views/agent_cookbook_view.dart` — added `_runRecipe` helper + Run `IconButton` on `_RecipeTile` (key `run-recipe-<id>`); SnackBar success/failure
  - `test/features/agent_cookbook/agent_cookbook_view_test.dart` — added `_FakeRunCookbookDataSource` + widget test "tapping Run calls runRecipe on data source and shows success SnackBar"
- Checks run:
  - `dart format .` — PASS (2 files reformatted, 0 errors)
  - `flutter analyze --no-fatal-infos` — PASS (0 errors, 0 warnings; 260 pre-existing infos)
  - `flutter test` — PASS (633/633, 0 fail; +1 new test)
- Decisions made: Run button returns `String?` from controller rather than throwing, matching the controller's existing `_error`-state pattern. SnackBar reads `controller.error` on null return.
- Deviations from spec: none
- Concerns: Visual smoke still needed before merging PR #734.
