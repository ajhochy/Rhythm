---
date: 2026-06-28
repo: Rhythm
branch: workflow/run-2026-06-28
pr: pending
issues: [782]
status: verified-pending-pr
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# Run — Fix #782: agent_trigger_watcher test failures (RHYTHM_LOCAL_SMOKE leak)

## Files changed

- `apps/desktop_flutter/lib/app/core/agents/agent_trigger_watcher.dart` —
  added optional `isFlutterTest` parameter (default `false`) to
  `computeIsLocalSmokeRun`; when `true`, the env-var smoke path is skipped
  (`if (isFlutterTest) return false;`, placed after the dart-define check). The
  `isLocalSmokeRun` getter now reads `Platform.environment['FLUTTER_TEST'] ==
  'true'` and threads it in.

## Checks run

- `RHYTHM_LOCAL_SMOKE=1 flutter test .../agent_trigger_watcher_test.dart` → 11/11 pass
  (was 6 failing before the fix, in the same leaked-env condition).
- `RHYTHM_LOCAL_SMOKE=1 flutter test .../issue_651_contract_test.dart` → 7/7 pass
  (sole other dependent of the changed symbol; signature change is additive).
- `RHYTHM_LOCAL_SMOKE=1 flutter test test/features/agents/` → 459 pass / 0 fail.
- `dart format --set-exit-if-changed` (changed file) → 0 changed.
- `flutter analyze --no-fatal-infos` (changed file) → No issues found.
- gitnexus `detect_changes` → risk LOW, 1 symbol touched, 0 affected processes.
- Commit: `a7880fb02` on `workflow/run-2026-06-28`.

## Notes

- **Root cause (not what the issue title said):** the 6 failures were NOT the
  "auth-change re-fire (F2)" tests — those two pass. The real failures were the
  polling / deduplicate / DELETE / isPolling / smoke-gate tests. All shared one
  cause: `RHYTHM_LOCAL_SMOKE=1` was exported in the test session's environment.
  Under `flutter test` (`kDebugMode == true`), `isLocalSmokeRun` honored it,
  `AgentTriggerWatcher.start()` no-op'd, and the watcher did nothing.
- This is the same class as #651 (a stale `launchctl setenv` leaking the smoke
  flag), but for debug/test runs rather than release DMGs. #651 hardened release
  builds; #782 hardens `flutter test`.
- **Test vs SUT:** the test was correct (line 558 explicitly asserts
  `isLocalSmokeRun` is false "in a normal test environment"). The SUT was
  environment-sensitive. Fixed the production wiring, not the test.
- **Contract preserved:** the #651 c8a–c8c tests assert the
  dart-define/env-var/debug-release matrix and do not pass `isFlutterTest`, so
  the additive default keeps them green and dart-define precedence intact.
- Production `flutter run` smoke behavior and #651 release hardening are
  unchanged — `FLUTTER_TEST` is set only by the Flutter test harness.

## Follow-ups

- None. The prior "6 pre-existing failures" risk note in `project-state.md` is
  now resolved and removed from the snapshot.
