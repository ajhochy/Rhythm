---
date: 2026-08-08
repo: Rhythm
branch: ui/desktop-mobile-session-polish
pr: 1337
issues: [1337]
status: pass
tags: [run, desktop_flutter, dashboard]
---

## Files

- `apps/desktop_flutter/lib/features/dashboard/views/dashboard_view.dart`
- `apps/desktop_flutter/lib/app/core/ui/focus_business_widgets.dart`
- `apps/desktop_flutter/test/features/dashboard/dashboard_glance_layout_contract_test.dart`
- `docs/ai/contracts/ui-dashboard-glance-layout.json`
- `docs/ai/runs/2026-08-08-dashboard-glance-layout.md`

## Checks

- FAIL-FIRST: `PATH=/Users/ajhochhalter/development/flutter/bin:$PATH flutter test test/features/dashboard/dashboard_glance_layout_contract_test.dart`
  - Before implementation: `ui-dashboard-glance-c2` failed as intended: the list began at x=64 while the summary's PROGRESS metric ended at x=443.5, proving it was below rather than right of the summary.
- PASS: same focused contract command — 10 tests pass. It proves 1024/1440 top-row pairing, tight 2x2 metrics, strict internal left/right list placement, no On Deck text, all six fixture tasks in the two scrollable period lists, empty completion copy without a heading, the unchanged default project-card layout, and a 1024x700/200% compact-card subtree with no exception.
- `PATH=/Users/ajhochhalter/development/flutter/bin:$PATH dart format --set-exit-if-changed lib/features/dashboard/views/dashboard_view.dart lib/app/core/ui/focus_business_widgets.dart test/features/dashboard/dashboard_glance_layout_contract_test.dart` — PASS.
- `PATH=/Users/ajhochhalter/development/flutter/bin:$PATH flutter analyze --no-fatal-infos` — PASS (exit 0; 288 existing info diagnostics).
- `PATH=/Users/ajhochhalter/development/flutter/bin:$PATH flutter build macos --debug` — PASS.
- FINAL FAIL-FIRST: `PATH=/Users/ajhochhalter/development/flutter/bin:$PATH flutter test test/features/dashboard/dashboard_glance_layout_contract_test.dart`
  - Before this refinement: `ui-dashboard-glance-c10`/`c11` failed with the compact dial inset at `17px`, above the required `8–12px` range.
- FINAL PASS: same focused contract command — 12 tests pass, including 1024px and 464px screenshot-width assertions for all metric-label render boxes remaining one line, compact inset, useful right-list width, top alignment, and no overflow.
- FINAL FORMAT: `PATH=/Users/ajhochhalter/development/flutter/bin:$PATH dart format lib/app/core/ui/focus_business_widgets.dart test/features/dashboard/dashboard_glance_layout_contract_test.dart --set-exit-if-changed` — PASS.
- FINAL ANALYZE: `PATH=/Users/ajhochhalter/development/flutter/bin:$PATH flutter analyze --no-fatal-infos` — PASS (exit 0; 290 existing info diagnostics).
- FINAL BUILD: `PATH=/Users/ajhochhalter/development/flutter/bin:$PATH flutter build macos --debug` — PASS (existing Pods macOS deployment-target warning only).

## Notes

- GitNexus impact: `_buildHero`, `_buildTaskProgressPanel`, and `_onDeckTaskItems` are LOW (one direct caller each); `FocusBusinessProjectProgress` is LOW (four direct callers, no affected processes).
- Compact Today/This Week bodies use one Row: a fixed 242px (narrow) / 246px (wide) dial-and-metrics summary, 12px gap, then the bounded 140px task list. Empty completion copy occupies the same right region. Checkbox, tap, avatar, done styling, and task order reuse the existing row implementation.
- Measured widget geometry: 1024 viewport — card x=46..505 (459px), dial x=63..151, list x=318..487 (169px), list top=353 vs dial top=352. 1440 viewport — card x=97..713 (616px), dial x=114..206, list x=373..695 (322px), list top=336 vs dial top=335.
- Only compact behavior changes: the ring is 88px below 500px content width and 92px otherwise; default non-compact project-card behavior remains unchanged.
- The complete DashboardView's prior 200%-scale `RhythmTaskCreateBar` overflow is still external and untouched. The focused contract deliberately exercises only the hero/card subtree at 200%, so it does not hide or attribute that task-bar error to the cards.
- AJ's live preview accepted the paired left-summary/right-list geometry; this final correction only reclaims compact shell and gap space. Compact-only panel inset is `10px` (measured dial-to-card-outline inset `11px` including the border), body/inner gaps are `8px`, and the metrics region is `166px` (about `90px`/`68px` across the two columns). At the 464px screenshot fixture the task-list viewport is `172px`; at the 1024 dashboard fixture it is about `167px`, both above the 150px floor. Ring remains 88px in the narrow fixture. Default noncompact panels retain their 16px padding.

## AJ final compact structure — 2026-08-08

- FAIL-FIRST: the focused contract command failed before implementation: `ui-dashboard-glance-c1` and the shared body-split assertions found the metrics at the dial's top (`346px`) and the ring at `88px`, proving the old side-by-side summary remained.
- PASS: `PATH=/Users/ajhochhalter/development/flutter/bin:$PATH flutter test test/features/dashboard/dashboard_glance_layout_contract_test.dart` — 12 tests pass. The contracts prove the one-row body, stacked dial/grid left column, 8px body/vertical gaps, 166px dial and grid, right scrollable list, one-line labels, 200% overflow safety, and paired cards.
- PASS: `PATH=/Users/ajhochhalter/development/flutter/bin:$PATH dart format --set-exit-if-changed lib/app/core/ui/focus_business_widgets.dart test/features/dashboard/dashboard_glance_layout_contract_test.dart`.
- PASS: `PATH=/Users/ajhochhalter/development/flutter/bin:$PATH flutter analyze --no-fatal-infos` — exit 0 with 288 existing info diagnostics.
- PASS: `PATH=/Users/ajhochhalter/development/flutter/bin:$PATH flutter build macos --debug` — built `Rhythm.app` (existing Pods deployment-target warning only).
- Measured at 1024x700: paired card `459x426px`; ring and left column `166px`; task-list viewport `261px`. At 1440x900: paired card `616x426px`; left column stays `166px`; task-list viewport `418px`. Compact panel inset remains 10px (11px to the outlined card edge). No data, actions, default noncompact behavior, or dashboard view files changed.

## Final visual evidence

- [PR #1337 UI smoke evidence](../evidence/2026-08-08-pr-1337-ui-smoke.md) records AJ's accepted paired dashboard preview and the final UI/UX reviewer PASS.
