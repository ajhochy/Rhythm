---
date: 2026-08-08
repo: Rhythm
branch: ui/desktop-mobile-session-polish
pr: 1337
issues: [ui-desktop-agents-session-pane]
status: pass
tags: [run, desktop_flutter]
---

## Files

- `apps/desktop_flutter/test/features/agents/agents_nav_column_mounted_test.dart`
- `apps/desktop_flutter/lib/features/agents/views/_agents_nav_column.dart`
- `apps/desktop_flutter/lib/features/agents/views/_session_list_body.dart`
- `docs/ai/contracts/ui-desktop-agents-session-pane.json`
- `apps/desktop_flutter/test/features/agents/issue_910_subagent_collapse_test.dart`

## Checks

- `export PATH="/Users/ajhochhalter/development/flutter/bin:$PATH"; cd apps/desktop_flutter && flutter test test/features/agents/agents_nav_column_mounted_test.dart test/features/agents/issue_910_subagent_collapse_test.dart` — PASS (30 tests). The repair acceptance run failed before implementation on absent selected/expanded semantics, duplicate Settings, and the Sessions rail shortcut.
- `export PATH="/Users/ajhochhalter/development/flutter/bin:$PATH"; cd apps/desktop_flutter && dart format --set-exit-if-changed lib/features/agents/views/agents_view.dart lib/features/agents/views/_agents_nav_column.dart lib/features/agents/views/_session_list_body.dart test/features/agents/agents_nav_column_mounted_test.dart` — PASS (0 changed).
- `export PATH="/Users/ajhochhalter/development/flutter/bin:$PATH"; cd apps/desktop_flutter && flutter analyze --no-fatal-infos` — PASS (0 errors; 278 pre-existing infos).
- `export PATH="/Users/ajhochhalter/development/flutter/bin:$PATH"; cd apps/desktop_flutter && flutter test test/features/agents/agents_nav_column_mounted_test.dart test/features/agents/issue_910_subagent_collapse_test.dart` — PASS (25 tests). Before repair, the added contracts failed: no `tools-heading` focus target and child-row height was 24px (<28px).
- `export PATH="/Users/ajhochhalter/development/flutter/bin:$PATH"; cd apps/desktop_flutter && flutter test test/features/agents/issue_910_subagent_collapse_test.dart` — PASS (4 tests).
- `export PATH="/Users/ajhochhalter/development/flutter/bin:$PATH"; cd apps/desktop_flutter && dart format --set-exit-if-changed lib/features/agents/views/_agents_nav_column.dart lib/features/agents/views/_session_list_body.dart test/features/agents/agents_nav_column_mounted_test.dart test/features/agents/issue_910_subagent_collapse_test.dart` — PASS (0 changed).
- `export PATH="/Users/ajhochhalter/development/flutter/bin:$PATH"; cd apps/desktop_flutter && flutter analyze --no-fatal-infos` — PASS (0 errors; 282 pre-existing infos).
- `export PATH="/Users/ajhochhalter/development/flutter/bin:$PATH" && cd apps/desktop_flutter && flutter test test/features/agents/agents_nav_column_mounted_test.dart test/features/agents/issue_910_subagent_collapse_test.dart` — FAIL before implementation: top-level `SessionRow` was 58px (required ≤40px), `SessionRowMenu` was 48px (required 30px), and `tools-resize-handle` was absent.
- `export PATH="/Users/ajhochhalter/development/flutter/bin:$PATH" && cd apps/desktop_flutter && dart format --set-exit-if-changed lib/features/agents/views/_agents_nav_column.dart lib/features/agents/views/_session_list_body.dart test/features/agents/agents_nav_column_mounted_test.dart` — PASS (0 changed).
- `export PATH="/Users/ajhochhalter/development/flutter/bin:$PATH" && cd apps/desktop_flutter && flutter test test/features/agents/agents_nav_column_mounted_test.dart test/features/agents/issue_910_subagent_collapse_test.dart` — PASS (28 tests). Contracts assert 38px top-level rows, 30px action targets, unchanged ≥28px child rows, and a `resizeUpDown` divider with 180px initial / 120–260px clamp.
- `export PATH="/Users/ajhochhalter/development/flutter/bin:$PATH" && cd apps/desktop_flutter && flutter test test/features/agents/issue_910_subagent_collapse_test.dart` — PASS (4 tests).
- `export PATH="/Users/ajhochhalter/development/flutter/bin:$PATH" && cd apps/desktop_flutter && flutter analyze --no-fatal-infos` — PASS (0 errors; 282 pre-existing infos).

## AJ combined Agents/Sub Agents header

- Acceptance-first run: `export PATH="/Users/ajhochhalter/development/flutter/bin:$PATH" && cd apps/desktop_flutter && flutter test test/features/agents/agents_nav_column_mounted_test.dart test/features/agents/issue_910_subagent_collapse_test.dart` — FAIL before implementation: `agents-disclosure` and `subagents-disclosure` were absent.
- Replaced the Sessions disclosure plus separate bulk line with one 28px transparent heading row: `AGENTS (N)` toggles the session region; `SUB AGENTS` uses the existing controller bulk-collapse action and is disabled when no visible child groups exist. Both use TOOLS tokens and standard focusable `TextButton` controls with explicit expanded semantics. Per-parent subagent summaries remain unchanged.
- Final: `export PATH="/Users/ajhochhalter/development/flutter/bin:$PATH" && cd apps/desktop_flutter && dart format --set-exit-if-changed lib/features/agents/views/_agents_nav_column.dart lib/features/agents/views/_session_list_body.dart test/features/agents/agents_nav_column_mounted_test.dart test/features/agents/issue_910_subagent_collapse_test.dart && flutter test test/features/agents/agents_nav_column_mounted_test.dart test/features/agents/issue_910_subagent_collapse_test.dart && flutter analyze --no-fatal-infos` — PASS (31 focused tests; 0 errors; 286 pre-existing infos).
- `git diff --check -- <owned files>` — PASS. GitNexus change detection is LOW with no affected processes; its shared-worktree report includes the pre-existing parallel global-navigation/mobile files, which were not edited in this run.
- No sandbox or live ports were used.

## Second AJ smoke correction

- Acceptance contract was updated before implementation. `flutter test test/features/agents/agents_nav_column_mounted_test.dart` failed as intended because the outer `project-filter-toolbar` was absent; this caught the prior inner-selector-only geometry assertion.
- The rendered mounted geometry at 1024×700 is: selector 24px, add 24px, sort 24px, refresh 24px; their vertical centers are equal; the outer toolbar band is 26px; its selector begins at the single 12px outer inset. Project labels are 11px and control icons are 13px. Scope tabs remain 28px.
- `export PATH="/Users/ajhochhalter/development/flutter/bin:$PATH" && cd apps/desktop_flutter && dart format --set-exit-if-changed lib/features/agents/views/_agents_nav_column.dart test/features/agents/agents_nav_column_mounted_test.dart && flutter test test/features/agents/agents_nav_column_mounted_test.dart test/features/agents/issue_910_subagent_collapse_test.dart && flutter analyze --no-fatal-infos` — PASS (29 focused tests; 0 analyze errors; 282 pre-existing infos).
- No sandbox or live ports were used. The repair is confined to the desktop Agents project/filter toolbar, its mounted contract, and this evidence; existing draggable Tools and session-density work remains untouched.
- `git diff --check -- apps/desktop_flutter/lib/features/agents/views/_agents_nav_column.dart apps/desktop_flutter/test/features/agents/agents_nav_column_mounted_test.dart docs/ai/contracts/ui-desktop-agents-session-pane.json docs/ai/runs/2026-08-08-desktop-agents-session-pane.md` — PASS.

## Notes

- Acceptance tests were reproduced failing before implementation: missing `session-scope-tabs` and `collapsed-nav-expand` keys.
- Scope, archive/resumable, and subagent disclosures use explicit button/expanded semantics and TextButtons. The Sessions rail opens an expanded sessions region; global Settings was removed while Agent settings remains. Existing controller, provider, API, persistence, and dependencies are unchanged.
- GitNexus impact: `_AgentsNavColumnState.build` LOW (0 direct callers); `SessionListBody`, `SessionRow`, and `SessionStatusDot` MEDIUM (6 direct callers, no execution processes).
- Final repair: the Tools shortcut now focuses the semantic `Tools` heading, which draws an accent border while focused. Child rows retain transparent default styling and now have a 28px minimum height.
- Final GitNexus impact: `_AgentsNavColumnState` LOW (1 direct importer) and `ChildSessionRow` MEDIUM (5 direct callers/importers); neither participates in an indexed execution process. Change detection reported only existing shared worktree UI changes, no affected process.
- AJ live-smoke feedback: keep the approved subagent rows and sticky Tools behavior; tighten only top-level session rows and make the Sessions/Tools boundary draggable. The update uses local transient state only; no sandbox or live `:4001`/`:4096` process was touched.
- AJ follow-up: Chats/Scheduled/Background scope-tab sizing is approved. The All Sessions project/filter row now matches its compact 28px height by constraining the selector container and removing its vertical dropdown padding; existing scope, project selection, sort, refresh, focus, menu, and error handling remain unchanged.
- `export PATH="/Users/ajhochhalter/development/flutter/bin:$PATH" && cd apps/desktop_flutter && flutter test test/features/agents/agents_nav_column_mounted_test.dart` — FAIL before implementation: `by-project-selector` measured `34.0`px, violating the 28px project/filter geometry contract.
- `export PATH="/Users/ajhochhalter/development/flutter/bin:$PATH" && cd apps/desktop_flutter && flutter test test/features/agents/agents_nav_column_mounted_test.dart test/features/agents/issue_910_subagent_collapse_test.dart` — PASS (29 tests); the new 1024×700 geometry contract asserts 28px selector/add/sort/refresh controls with equal vertical centers and unchanged 28px scope tabs.
- `export PATH="/Users/ajhochhalter/development/flutter/bin:$PATH" && cd apps/desktop_flutter && dart format --set-exit-if-changed lib/features/agents/views/_agents_nav_column.dart test/features/agents/agents_nav_column_mounted_test.dart` — PASS (0 changed after formatting).
- `export PATH="/Users/ajhochhalter/development/flutter/bin:$PATH" && cd apps/desktop_flutter && flutter analyze --no-fatal-infos` — PASS (0 errors; 282 pre-existing infos).

## Final Tools splitter accessibility/correctness gate repair

- UI gate **FAIL before implementation**: the new mounted contracts showed that reopening Agents retained a stale 443px Tools height instead of the 376px expanded maximum; the splitter also exposed no `Resize Tools panel` semantics, adjustable actions, or keyboard operation.
- The splitter now has focusable slider semantics with `Resize Tools panel` and a live pixel value, increase/decrease actions, and a visible accent/thicker focus line. Up increases Tools by 16px; Down decreases it by 16px. Pointer drag, keyboard, and semantic actions use the same clamp helper.
- Every layout renders the effective current clamp without mutating state during build. The mounted contract verifies 180px initial, 120px minimum, 376px expanded and 443px collapsed maxima at 1024×700; reopening Agents reclamps 443px to 376px, and shrinking to 1024×600 immediately renders 276px without overflow.
- `export PATH="/Users/ajhochhalter/development/flutter/bin:$PATH" && cd apps/desktop_flutter && flutter test test/features/agents/agents_nav_column_mounted_test.dart` — FAIL before implementation (two expected contract failures: stale 443px after reopening Agents; missing splitter semantics).
- `export PATH="/Users/ajhochhalter/development/flutter/bin:$PATH" && cd apps/desktop_flutter && dart format --set-exit-if-changed lib/features/agents/views/_agents_nav_column.dart test/features/agents/agents_nav_column_mounted_test.dart && flutter test test/features/agents/agents_controller_test.dart test/features/agents/agents_nav_column_mounted_test.dart test/features/agents/issue_910_subagent_collapse_test.dart && flutter analyze --no-fatal-infos` — PASS (focused Agents suite; 0 errors; 288 pre-existing infos).
- No sandbox or live ports were used; no commit or push was performed.

## AJ approved follow-up — collapsed Sub Agents, dynamic Tools, header search

- Acceptance-first: `export PATH="/Users/ajhochhalter/development/flutter/bin:$PATH" && cd apps/desktop_flutter && flutter test test/features/agents/agents_nav_column_mounted_test.dart test/features/agents/issue_910_subagent_collapse_test.dart` — FAIL before implementation as required: child rows and disclosure semantics were expanded by default, Tools capped at 260px, and `nav-search-field` rendered in the body initially.
- Parent groups now default collapsed in-memory by retaining only explicitly expanded IDs. Per-parent and bulk toggle APIs retain their public names and run-local behavior.
- Header search replaces the body field: a labeled 30px search control opens an autofocus field; Close/Escape clear filtering, restore the title, and return focus to the search toggle. New/options centers remain stable.
- Dynamic Tools clamp uses the actual 676px mounted pane constraint. At 1024×700, the verified maximum is **376px** with Agents expanded and **443px** with Agents collapsed; min remains 120px and initial remains 180px. Both states have no overflow.
- Final: `export PATH="/Users/ajhochhalter/development/flutter/bin:$PATH" && cd apps/desktop_flutter && dart format --set-exit-if-changed lib/features/agents/controllers/agents_controller.dart lib/features/agents/views/_agents_nav_column.dart test/features/agents/agents_controller_test.dart test/features/agents/agents_nav_column_mounted_test.dart test/features/agents/issue_910_subagent_collapse_test.dart && flutter test test/features/agents/agents_controller_test.dart test/features/agents/agents_nav_column_mounted_test.dart test/features/agents/issue_910_subagent_collapse_test.dart && flutter analyze --no-fatal-infos` — PASS (81 focused tests; 0 errors; 288 pre-existing infos).
- `python3 -m json.tool docs/ai/contracts/ui-desktop-agents-session-pane.json` and `git diff --check -- <owned files>` — PASS. GitNexus detects the shared worktree as LOW risk with no affected processes; unrelated all-tabs/mobile edits were preserved untouched.
- No sandbox or live ports were started. AJ subsequently PASSed the separate desktop build smoke.

## Final visual evidence

- [PR #1337 UI smoke evidence](../evidence/2026-08-08-pr-1337-ui-smoke.md) records AJ's PASS of the 24px toolbar, compact rows, Agents/Sub Agents controls and default collapse, draggable Tools (including high range), and header search.
