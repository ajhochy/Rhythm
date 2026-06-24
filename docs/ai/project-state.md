# Project State

## Current focus

**2026-06-23 — feature/agent-scheduler: #738-fix landed; manual smoke still pending**

Branch `feature/agent-scheduler`. All planned backend + Flutter work items are headless-verified, including the #738-fix that makes autonomous agent runs actually execute:

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

Visual smoke (`flutter run -d macos`) is required before merging.

---

## Active branch / PR

- **Branch:** `feature/agent-scheduler` (pushed; HEAD `ba6443a`; #738-fix changes uncommitted)
- **PR:** [#734](https://github.com/ajhochy/Rhythm/pull/734) — open
- **Base:** `main`

---

## In progress

Nothing actively in flight. Waiting on:
1. Commit + push the #738-fix changes (11 files modified).
2. User manual smoke (`flutter run -d macos`) — confirm nav column, Cookbook/Email/Gallery views, Edit button on scheduled task detail sheet, and form pre-fill; also verify a scheduled task actually fires and produces a session row in CHATS.
3. PR merge after smoke passes.

---

## Risks / known issues

- **Visual gap:** `flutter run` was forbidden during all coding sessions. Run manual smoke before merging.
- **Bundled api_server — MCP_ROLES_DIR:** In the Flutter `.app` bundle the api_server is embedded under `$resourcesDir/api_server/` without the full repo tree. The default `MCP_ROLES_DIR` path won't resolve `.mcp-roles/`. Operators must set `MCP_ROLES_DIR` env var for role-scoped sessions to work in production.
- **SDK tool-gating limitation (C1):** The OpenCode SDK `session.create` has no per-session tool allowlist parameter. The C1 init-time gate stores the allowlist on the `agent_sessions` row; full enforcement requires the WS gateway to honour it (future work).
- **AgentRunner polling latency:** Up to 500 ms added to result detection vs. SSE (by design — see `docs/ai/decisions/2026-06-23-agent-runner-polling-vs-sse.md`).
- **`notification` outputTarget is a TODO stub** in `agent_runner.ts` — no notification endpoint shape finalized yet.
- **#738-fix model default:** `resolveRunModel` falls back to `anthropic/claude-sonnet-4-5` when no agent config model and no MRU session exists. If the user's opencode instance has no anthropic provider configured, the run will fail at promptAsync time (fast fail, not silent hang). User should set `model_provider`/`model_id` on their agent config profile via PATCH `/agent-configs/:id`.

---

## Test status

| Suite | Status |
|-------|--------|
| `dart format .` | PASS — 0 changed (last verified 2026-06-23) |
| `flutter analyze --no-fatal-infos` | PASS — 0 errors, 0 warnings (last verified 2026-06-23) |
| `flutter test` (full) | **635 PASS, 0 FAIL** (+2 new edit-mode tests, last verified 2026-06-23) |
| `api_server tsc --noEmit` | PASS — 0 errors (last verified 2026-06-23) |
| `api_server npm test` | **965/965 PASS** (+12 from #738-fix, last verified 2026-06-23) |

---

## Next step

1. **Commit #738-fix changes** — 11 files in `apps/api_server/`.
2. **Manual smoke** — `flutter run -d macos`:
   - Confirm nav column header/footer pinned, middle scrolls, all TOOLS rows reachable.
   - Confirm Cookbook/Email/Gallery views open.
   - Confirm Edit button appears in scheduled task detail sheet; form pre-fills correctly.
   - Confirm Save calls PATCH (not POST).
   - **NEW:** Trigger a scheduled task and confirm a session row appears in CHATS list (verifies #738-fix end-to-end).
3. **Merge PR #734** after smoke passes.

---

**Run history:** one file per run under `docs/ai/runs/` (surfaced as `ai-runs/`); prior log in `runs/_migrated-2026-06-18.md`. Snapshot overwritten in place.
