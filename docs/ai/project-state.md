# Project State

## Current focus

**2026-06-23 — Odysseus Phase B: rich session row extraction complete (headless verified, awaiting visual smoke)**

Branch `feature/agent-scheduler`. Phase A (single-column nav shell) and Phase B (rich session row extraction + nav column rewire) are both verified and committed. The nav column's CHATS body now uses the shared `SessionListBody` from `_session_list_body.dart`; all dead `_SessionListPanel` / lean nav row code has been deleted. 7 nav column tests pass; 406/406 agents suite tests pass (2 pre-existing failures in `new_session_dialog_error_test.dart` — not regressions).

Visual smoke (`flutter run -d macos`) is still required before opening a PR — the task hard lock forbade `flutter run` during the coding pass.

---

## Active branch / PR

- **Branch:** `feature/agent-scheduler` (local, not yet pushed for a PR)
- **PR:** not yet opened
- **Base:** `main`

---

## In progress

Nothing actively in flight. Phase B is done. Waiting on:
1. User manual smoke (`flutter run -d macos` against `https://api.vcrcapps.com`) to confirm visual fidelity of the nav column CHATS body (rich session rows with model badges).
2. PR open after smoke passes.

---

## Risks / known issues

- **Visual gap:** `flutter run` was forbidden during Phase B coding. The rich session rows have test coverage but no screenshot verification. Run manual smoke before merging.
- **Phase C / D not started:** Cookbook backend (B1/B2), Agentic Email (C1–C3), Gallery (D1–D2) are planned but not implemented. See `docs/ai/current-plan.md`.
- **2 pre-existing test failures** in `new_session_dialog_error_test.dart` — not caused by this branch; tracked but not in scope.
- **MCP package pin TODOs** from the prior MCP-autoinstall run (branch `workflow/run-2026-06-16-mcp-autoinstall`): several community MCP packages have `TODO(verify-pin)` comments; confirm before release.

---

## Test status

| Suite | Status |
|-------|--------|
| `dart format .` | PASS — 0 changed |
| `flutter analyze --no-fatal-infos` | PASS — 0 errors, 0 warnings |
| `flutter test test/features/agents/` | 406 PASS, 2 FAIL (pre-existing `new_session_dialog_error_test.dart`) |
| `flutter test test/features/agents/agents_nav_column_mounted_test.dart` | 7/7 PASS |

---

## Next step

1. **Manual smoke** — `flutter run -d macos`: open Agents screen, confirm nav column CHATS body shows session rows with model badge (e.g. "Claude Code"), archived section header collapses/expands, search filters work.
2. **Open PR** on `feature/agent-scheduler` → `main` after smoke passes.
3. **Phase C** — start with issue B1 (Cookbook backend) or C1 (mcpRole session gating), per `docs/ai/current-plan.md`.

---

## Recent coding-agent runs

### 2026-06-23 — odysseus-phase-b-rich-session-rows

- Files modified:
  - `apps/desktop_flutter/lib/features/agents/views/_session_list_body.dart` (NEW): extracted rich row widgets from dead `_SessionListPanel` — `SessionListBody`, `SessionRow`, `ResumableSessionRow`, `ArchivedSessionRow`, `AgentKindBadge`, `AgentConfigBadge`, `SessionStatusDot`, `SessionRowMenu`; all public
  - `apps/desktop_flutter/lib/features/agents/views/_agents_nav_column.dart`: rewired CHATS body to `SessionListBody`; added `_onToggleArchived()`; deleted all lean nav row classes
  - `apps/desktop_flutter/lib/features/agents/views/agents_view.dart`: deleted ~1,170 lines of dead code; updated test harnesses to public API; updated `_TranscriptHeader` badge reference
  - `apps/desktop_flutter/test/features/agents/agents_nav_column_mounted_test.dart`: added tests (8) model badge + (9) archived section header
- Checks run:
  - `dart format .` — PASS (0 changed)
  - `flutter analyze --no-fatal-infos` — PASS: 0 errors, 0 warnings
  - `flutter test test/features/agents/agents_nav_column_mounted_test.dart` — PASS: 7/7
  - `flutter test test/features/agents/` — 406 PASS, 2 pre-existing failures only
- Decisions made: public widget names for cross-file import; `SessionListHeaderTestHarness` rewritten as standalone; shift-click keyboard handling stays in nav column caller
- Deviations from spec: list padding uses nav column's existing `(12,4,12,12)` not panel's `(12,12,12,14)` — intentional
- Concerns: visual smoke required (flutter run was forbidden); 2 pre-existing test failures in new_session_dialog_error_test.dart unchanged

### 2026-06-23 — odysseus-phase-a-left-panel-rebuild

- Files modified:
  - `apps/desktop_flutter/lib/features/agents/views/_agents_nav_column.dart` (NEW): Odysseus-style nav column — header, New Session, search, CHATS, TOOLS, footer
  - `apps/desktop_flutter/lib/features/agents/views/agents_view.dart`: replaced ProjectsRail + _SessionListPanel with AgentsNavColumn; removed toolbar icons; added _navCollapsed state
  - `apps/desktop_flutter/lib/features/settings/views/settings_view.dart`: removed _OdysseusSection and _OdysseusNavTile dead classes
  - `apps/desktop_flutter/test/features/agents/agents_nav_column_mounted_test.dart` (NEW): 5 real-surface tests
- Checks run: dart format, flutter analyze, 5/5 nav column tests, 4/4 inspector tests — all PASS
- Decisions made: `setActiveSessionForTest()` to avoid timer fires; `_SessionListPanel` kept (dead) for Phase B cleanup; lean inline rows used for nav (Phase B rewired to rich)
- Deviations: `_SessionListPanel` was not yet deleted (done in Phase B)

---

**Run history:** one file per run under `docs/ai/runs/` (surfaced as `ai-runs/`); prior log in `runs/_migrated-2026-06-18.md`. Snapshot overwritten in place.
