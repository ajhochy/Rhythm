---
date: 2026-08-08
repo: Rhythm
branch: ui/desktop-mobile-session-polish
pr: null
issues: [ui-desktop-global-navigation]
status: ready_for_verification
tags: [run, desktop_flutter]
---

## Files

- `apps/desktop_flutter/test/app/core/layout/global_navigation_contract_test.dart`
- `apps/desktop_flutter/lib/app/core/layout/app_shell.dart`
- `apps/desktop_flutter/lib/app/core/layout/navigation_sidebar.dart`
- `docs/ai/contracts/ui-desktop-global-navigation.json`

## Checks

- `export PATH="/Users/ajhochhalter/development/flutter/bin:$PATH" && cd apps/desktop_flutter && flutter test test/app/core/layout/global_navigation_contract_test.dart` — PASS (6 tests). The repair acceptance run failed before implementation on the FittedBox and missing accessible unread indicator assertions.
- `export PATH="/Users/ajhochhalter/development/flutter/bin:$PATH" && cd apps/desktop_flutter && dart format --set-exit-if-changed lib/app/core/layout/app_shell.dart lib/app/core/layout/navigation_sidebar.dart test/app/core/layout/global_navigation_contract_test.dart` — PASS (clean).
- `export PATH="/Users/ajhochhalter/development/flutter/bin:$PATH" && cd apps/desktop_flutter && flutter analyze --no-fatal-infos` — PASS (278 pre-existing/info-level findings; no errors).
- `GitNexus detect_changes(scope: all)` — LOW risk; this slice touches `_AppContent` and `NavigationSidebar`. Other worktree changes are owned by parallel agents and were not modified.

## Notes

The header now has a 52px minimum and reflows rather than scaling labels down. At 200% scale it moves overflow routes into More; unread count is an accessible accent indicator rather than white text on danger.
