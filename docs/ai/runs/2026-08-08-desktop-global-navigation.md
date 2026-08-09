---
date: 2026-08-08
repo: Rhythm
branch: ui/desktop-mobile-session-polish
pr: 1337
issues: [ui-desktop-global-navigation]
status: pass
tags: [run, desktop_flutter]
---

## Files

- `apps/desktop_flutter/test/app/core/layout/global_navigation_contract_test.dart`
- `apps/desktop_flutter/lib/app/core/layout/app_shell.dart`
- `apps/desktop_flutter/lib/app/core/layout/navigation_sidebar.dart`
- `docs/ai/contracts/ui-desktop-global-navigation.json`

## Checks

- Previous repair: `flutter test test/app/core/layout/global_navigation_contract_test.dart` — PASS (7 tests), but AJ's second wide desktop smoke exposed the header's 50/50 `Flexible`/`Spacer` allocation.
- `export PATH="/Users/ajhochhalter/development/flutter/bin:$PATH" && cd apps/desktop_flutter && flutter test test/app/core/layout/global_navigation_contract_test.dart` — FAIL before repair (2 of 9): representative 1600px complete-header fixture hid `Messages` and later tabs because the nav had half of the 1420px pre-control width; selected Dashboard resolved to persistent `accentMuted` fill instead of transparent.
- `export PATH="/Users/ajhochhalter/development/flutter/bin:$PATH" && cd apps/desktop_flutter && dart format --set-exit-if-changed lib/app/core/layout/app_shell.dart lib/app/core/layout/navigation_sidebar.dart test/app/core/layout/global_navigation_contract_test.dart && flutter test test/app/core/layout/global_navigation_contract_test.dart && flutter analyze --no-fatal-infos && flutter build macos --debug` — PASS: 9 focused tests; format clean; analyze exit 0 (282 existing info findings); macOS debug app built without launching or touching AJ's live services.

## Notes

AJ's first rendered smoke found `More` centered alone on a second line. The first repair made overflow single-row, but AJ's second wide smoke found a large blank region after the nav: `_AppContent` placed `NavigationSidebar` in `Flexible` beside another flex child (`Spacer`), halving its available width before the activity/account controls.

This repair uses `Expanded` for the nav and removes that `Spacer`, so the nav receives all width preceding the existing activity/account controls. At the 1600px representative complete-header geometry, all 10 tabs are visible and `More` is absent; at 1024px/200%, four tabs remain visible and the other six are reachable through `More` on a 48px row. Selected tabs are transparent except on hover, use a 2px accent underline, and retain a separate 2px focus side. No backend sandbox applies to this visual-only Flutter layout repair.

## Final visual evidence

- [PR #1337 UI smoke evidence](../evidence/2026-08-08-pr-1337-ui-smoke.md) records AJ's PASS of all fitting tabs, the 48px navigation row, and preserved Settings access.
