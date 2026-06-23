---
index: "[[Rhythm]]"
date: 2026-06-23
repo: Rhythm
branch: feature/agent-scheduler
pr: not yet opened
issues: nav-column-overflow
status: verified (headless) — manual smoke pending
tags: [run, Rhythm]
---

# Run: Nav column layout overflow fix + short-surface regression test

Closed the 5 pre-existing nav column test failures noted in `2026-06-23-b2-c3-d2-flutter-features.md`.
All 9 `agents_nav_column_mounted_test.dart` tests now pass; only the 2 known
`new_session_dialog_error_test.dart` failures remain.

## Root cause

The 8-row TOOLS section (5 original + Cookbook/Email/Gallery added in B2/C3/D2) exceeded the
height available in the outer Column at test surface sizes (900px). The prior fix attempt used
`Expanded(inner_Column([Expanded(SessionListBody), Divider, _ToolsSection]))` but failed because
the nav column Container received **loose** height constraints from the `Row` in `_buildWorkspace`
(default `CrossAxisAlignment.center` → no tight height propagation). Without tight constraints,
`Expanded` in the outer Column cannot resolve its allocation, leaving the session list body with
near-zero height and `_EmptyChatsState`'s fixed-height content overflowing.

## Fix

Two targeted changes:

1. **`agents_view.dart`** — added `crossAxisAlignment: CrossAxisAlignment.stretch` to the
   workspace `Row` so all Row children (including `AgentsNavColumn`) receive tight height
   constraints equal to the Row's height.

2. **`_agents_nav_column.dart`** — replaced the nested `Expanded(inner_Column)` structure with
   `Expanded(SingleChildScrollView(Column([SessionListBody(shrinkWrap:true), Divider, _ToolsSection])))`.
   The middle region (CHATS controls + session list + TOOLS) now scrolls as a single area.
   Header and footer remain pinned outside the scroll. This matches the original task spec:
   "Header pinned, footer pinned, middle scrolls as one area when vertical space is tight."

See `docs/ai/decisions/2026-06-23-nav-column-scroll-layout.md` for the architectural choice.

## Files changed

- `lib/features/agents/views/agents_view.dart` — `CrossAxisAlignment.stretch` on workspace Row
- `lib/features/agents/views/_agents_nav_column.dart` — scrollable middle region via `SingleChildScrollView`; updated file-level comment (removed stale "will slot in later phases" note)
- `test/features/agents/agents_nav_column_mounted_test.dart` — added B2/C3/D2 provider stubs + test 11 (short-surface 680px regression)

> Note: `_session_list_body.dart` had an intermediate `SingleChildScrollView` added and then
> reverted in this session — it ended up unchanged from the B2/C3/D2 run state (shrinkWrap
> parameter already present).

## Checks run

| Check | Result |
|-------|--------|
| `dart format . --set-exit-if-changed` | PASS — 0 changed |
| `flutter analyze --no-fatal-infos` | PASS — 0 errors, 0 warnings, 259 pre-existing infos |
| `flutter test test/features/agents/` | 410 PASS, 2 FAIL (pre-existing `new_session_dialog_error_test.dart` only) |
| Nav column tests (all 9) | PASS — including new test 11 at Size(1200,680) |

Branch: `feature/agent-scheduler`  
Commit: `227bbdeab07746320860bf03e9eb5a47c27f5155`

## Notes

- `flutter run` was forbidden during this session. Manual visual smoke required before PR.
- `CrossAxisAlignment.stretch` now propagates tight height to `SessionSidePanel` and
  `_InspectorResizeHandle` too. Both already handled tight height correctly; visual smoke
  should confirm no regressions on the inspector rail.
