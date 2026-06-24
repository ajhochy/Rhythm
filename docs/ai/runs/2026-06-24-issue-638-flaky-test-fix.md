---
date: 2026-06-24
repo: Rhythm
branch: feature/agent-scheduler
pr: 734
issues: [638]
status: verified
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# issue_638_contract_test — de-flake (shared_preferences mock)

## Files changed
- `apps/desktop_flutter/test/features/agents/issue_638_contract_test.dart`
  — added `import 'package:shared_preferences/shared_preferences.dart';` and
  `setUp(() => SharedPreferences.setMockInitialValues(<String, Object>{}));`.
- `docs/ai/project-state.md` — removed `issue_638_contract` from the known-flaky
  note; recorded the fix.

## Checks run
- `flutter test issue_638_contract_test.dart` — 20/20 green across repeated runs
  (15× then 5×), 0 failures.
- Full agents suite — 418/418.
- `dart format --set-exit-if-changed` — clean (exit 0).
- `flutter analyze --no-fatal-infos` — exit 0 (1 pre-existing `prefer_const_constructors`
  info @ line 527, commit 13c069fe — not this change).

## Notes
- **Root cause:** `AgentsController.initialize()` fires `unawaited(loadInspectorPrefs())`
  (agents_controller.dart:1179), which calls `SharedPreferences.getInstance()`. The
  c2 *unit* test (`test()`, not `testWidgets`) does `await controller.initialize()`
  then finishes with synchronous expects — so the test body completes before the
  unawaited `getInstance()` microtask resolves. With no mock registered the plugin
  channel rejects (`MissingPluginException`) *after* teardown → "This test failed
  after it had already completed." `testWidgets` callers pump/settle in real async,
  so the future resolves-and-is-caught inside the body — which is why only the c2
  unit test flaked.
- **Pattern source:** mirrors the existing idiom in `inspector_collapse_state_test`,
  `inspector_width_state_test`, `inspector_resize_mounted_test`. No shared
  controller-builder helper exists; each agents test constructs its own controller,
  so the guard was added directly to the issue_638 file.
- **Other `initialize()` callers verified:** the remaining non-mocked callers are
  `testWidgets`-based (pump/settle absorbs the future) — not fixed here to avoid
  scope expansion; flagged as a possible follow-up sweep if any later flakes.
