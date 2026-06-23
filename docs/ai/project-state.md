# Project State

## Current focus

**2026-06-23 — C1 (mcpRole session gating) complete; Phase B visual smoke still pending**

Branch `feature/agent-scheduler`. Three work items are done and headless-verified on this branch:

- **Phase A** — Odysseus-style nav column shell (`_agents_nav_column.dart`)
- **Phase B** — Rich session row extraction (`_session_list_body.dart`); nav column wired
- **C1** — api_server `POST /agent-sessions` now accepts optional `mcpRole` with path-traversal guard; unknown role → 400 (no silent fallback); resolved allowlist persisted on `agent_sessions` row and passed to `opencodeClient.createSession()` at init time

Visual smoke (`flutter run -d macos`) is still required for Phases A/B before opening a PR — the hard lock forbade `flutter run` during those coding passes.

---

## Active branch / PR

- **Branch:** `feature/agent-scheduler` (local, not yet pushed for a PR)
- **PR:** not yet opened
- **Base:** `main`

---

## In progress

Nothing actively in flight. Waiting on:
1. User manual smoke (`flutter run -d macos` against `https://api.vcrcapps.com`) to confirm visual fidelity of the nav column CHATS body.
2. PR open after smoke passes.

---

## Risks / known issues

- **Visual gap:** `flutter run` was forbidden during Phases A/B. Run manual smoke before merging.
- **Phase C/D not started:** Agentic Email (C2–C3), Gallery (D1–D2) are planned but not implemented. See `docs/ai/current-plan.md`.
- **Bundled api_server — MCP_ROLES_DIR:** In the Flutter `.app` bundle the api_server is embedded under `$resourcesDir/api_server/` without the full repo tree. The default `MCP_ROLES_DIR` path (derived from `__dirname`) won't resolve `.mcp-roles/`. Operators must set `MCP_ROLES_DIR` env var for role-scoped sessions to work in production.
- **SDK tool-gating limitation (C1):** The OpenCode SDK `session.create` has no per-session tool allowlist parameter. The C1 init-time gate stores the allowlist on the `agent_sessions` row; full enforcement requires the WS gateway to honour it (future work). The design is documented in `opencode_client_service.ts`.
- **2 pre-existing test failures** in `new_session_dialog_error_test.dart` — not caused by this branch.
- **MCP package pin TODOs** from prior `workflow/run-2026-06-16-mcp-autoinstall` branch.

---

## Test status

| Suite | Status |
|-------|--------|
| `dart format .` | PASS — 0 changed |
| `flutter analyze --no-fatal-infos` | PASS — 0 errors, 0 warnings |
| `flutter test test/features/agents/` | 406 PASS, 2 FAIL (pre-existing) |
| `api_server tsc --noEmit` | PASS — 0 errors |
| `api_server npm test` | 917/917 PASS, 105/105 files |

---

## Next step

1. **Manual smoke** — `flutter run -d macos`: confirm nav column CHATS body shows rich session rows with model badge, archived section header, search filter.
2. **Open PR** on `feature/agent-scheduler` → `main` after smoke passes.
3. **Phase C (C2/C3)** or **Phase D (D1/D2)** — next issues from `docs/ai/current-plan.md`.

---

**Run history:** one file per run under `docs/ai/runs/` (surfaced as `ai-runs/`); prior log in `runs/_migrated-2026-06-18.md`. Snapshot overwritten in place.
