# Project State

## Current focus

**2026-06-23 — B2/C3/D2 Flutter features complete; nav column overflow fixed; ready for PR**

Branch `feature/agent-scheduler`. All planned work items are headless-verified:

- **Phase A** — Odysseus-style nav column shell (`_agents_nav_column.dart`)
- **Phase B** — Rich session row extraction (`_session_list_body.dart`); nav column wired
- **C1** — api_server `POST /agent-sessions` accepts optional `mcpRole` with path-traversal guard
- **B1** — `agent_cookbook` table (SQLite + Postgres) + CRUD routes + repository/controller
- **C2** — `email-assistant.mcp.json` role file + `GET /integrations/gmail-signals` endpoint
- **D1** — `graphic-designer.mcp.json` role file + `agent_designs` table + CRUD routes
- **B2** — Flutter Cookbook feature (view/controller/repository/data source) + nav row
- **C3** — Flutter Email feature + nav row
- **D2** — Flutter Gallery feature + nav row
- **Nav overflow fix** — nav column middle region now scrolls as one area; header/footer pinned; all 9 nav column tests pass

Visual smoke (`flutter run -d macos`) is required before opening a PR.

---

## Active branch / PR

- **Branch:** `feature/agent-scheduler` (local, not yet pushed for a PR)
- **PR:** not yet opened
- **Base:** `main`

---

## In progress

Nothing actively in flight. Waiting on:
1. User manual smoke (`flutter run -d macos` against `https://api.vcrcapps.com`) to confirm visual fidelity of the full nav column (CHATS body, TOOLS section, short-window scroll).
2. PR open after smoke passes.

---

## Risks / known issues

- **Visual gap:** `flutter run` was forbidden during all coding sessions. Run manual smoke before merging.
- **Bundled api_server — MCP_ROLES_DIR:** In the Flutter `.app` bundle the api_server is embedded under `$resourcesDir/api_server/` without the full repo tree. The default `MCP_ROLES_DIR` path won't resolve `.mcp-roles/`. Operators must set `MCP_ROLES_DIR` env var for role-scoped sessions to work in production.
- **SDK tool-gating limitation (C1):** The OpenCode SDK `session.create` has no per-session tool allowlist parameter. The C1 init-time gate stores the allowlist on the `agent_sessions` row; full enforcement requires the WS gateway to honour it (future work).
- **2 pre-existing test failures** in `new_session_dialog_error_test.dart` — not caused by this branch.
- **C2 gmail catalog:** No third-party gmail MCP was added to `curated_mcp_servers.ts` (parent prompt override; rhythm MCP already has email tools). See `docs/ai/decisions/2026-06-23-c2-no-third-party-gmail-mcp.md`.
- **`CrossAxisAlignment.stretch` on workspace Row** — all workspace row children now receive tight height. Visual smoke should confirm no regressions on `SessionSidePanel` / `_InspectorResizeHandle`. See `docs/ai/decisions/2026-06-23-nav-column-scroll-layout.md`.

---

## Test status

| Suite | Status |
|-------|--------|
| `dart format .` | PASS — 0 changed |
| `flutter analyze --no-fatal-infos` | PASS — 0 errors, 0 warnings |
| `flutter test test/features/agents/` | 410 PASS, 2 FAIL (pre-existing) |
| `api_server tsc --noEmit` | PASS — 0 errors (from prior run; unchanged) |
| `api_server npm test` | 936/936 PASS (from prior run; api_server unchanged) |

---

## Next step

1. **Manual smoke** — `flutter run -d macos`: confirm nav column header/footer pinned, middle scrolls, all TOOLS rows reachable, search filter works, Cookbook/Email/Gallery views open.
2. **Open PR** on `feature/agent-scheduler` → `main` after smoke passes.

---

**Run history:** one file per run under `docs/ai/runs/` (surfaced as `ai-runs/`); prior log in `runs/_migrated-2026-06-18.md`. Snapshot overwritten in place.
