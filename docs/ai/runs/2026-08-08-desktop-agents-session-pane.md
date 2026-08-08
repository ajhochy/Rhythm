---
date: 2026-08-08
repo: Rhythm
branch: ui/desktop-mobile-session-polish
pr: null
issues: [ui-desktop-agents-session-pane]
status: ready_for_verification
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

## Notes

- Acceptance tests were reproduced failing before implementation: missing `session-scope-tabs` and `collapsed-nav-expand` keys.
- Scope, archive/resumable, and subagent disclosures use explicit button/expanded semantics and TextButtons. The Sessions rail opens an expanded sessions region; global Settings was removed while Agent settings remains. Existing controller, provider, API, persistence, and dependencies are unchanged.
- GitNexus impact: `_AgentsNavColumnState.build` LOW (0 direct callers); `SessionListBody`, `SessionRow`, and `SessionStatusDot` MEDIUM (6 direct callers, no execution processes).
- Final repair: the Tools shortcut now focuses the semantic `Tools` heading, which draws an accent border while focused. Child rows retain transparent default styling and now have a 28px minimum height.
- Final GitNexus impact: `_AgentsNavColumnState` LOW (1 direct importer) and `ChildSessionRow` MEDIUM (5 direct callers/importers); neither participates in an indexed execution process. Change detection reported only existing shared worktree UI changes, no affected process.
