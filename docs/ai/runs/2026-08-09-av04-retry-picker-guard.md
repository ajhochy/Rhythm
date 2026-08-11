---
date: 2026-08-09
repo: Rhythm
branch: feat/artifact-viewer
pr: null
issues: [AV-04]
status: ready_for_verification
tags: [run, desktop_flutter, live-artifacts, security]
---

# AV-04 retry picker stale-response guard

## Files

- `apps/desktop_flutter/lib/features/live_artifacts/controllers/live_artifacts_controller.dart`
- `apps/desktop_flutter/test/features/live_artifacts/av04_final_repair_contract_test.dart`
- `docs/ai/contracts/live-artifacts-av04.json`

## Contract

`av04-c22` adds deterministic controller tests for a deferred user-A retry that
arrives after logout, fails after user-B restore/list, and loses to a newer
concurrent retry. The A→B failure snapshots notification count immediately
before completion and proves it does not change; the concurrent retry test
snapshots latest inventory, null error, and one notification after newer
success, then proves all three remain unchanged after the older failure.

WAIVED: evidence-only test strengthening; verification is: focused AV04 tests and normal goldens, Flutter format/analyze/full suite, sandbox lifecycle, and diff check.

Pre-implementation failure:

```text
PATH=/Users/ajhochhalter/development/flutter/bin:$PATH flutter test test/features/live_artifacts/av04_final_repair_contract_test.dart
Expected: empty / Actual: [Instance of 'LiveArtifact']
Expected: null / Actual: 'Could not load live artifacts. Try again.'
Expected: 'Latest inventory' / Actual: 'Stale inventory'
```

The repair captures user ID, restore generation, and a picker request token;
stale success/failure paths return before state writes or notification.

## Checks

- PASS — focused contract: `PATH=/Users/ajhochhalter/development/flutter/bin:$PATH flutter test test/features/live_artifacts/av04_final_repair_contract_test.dart test/features/live_artifacts/av04_review_contract_test.dart test/features/live_artifacts/dashboard_artifact_tabs_test.dart` (29 tests, normal goldens).
- PASS — format/analyze/full: `dart format . --set-exit-if-changed` (453 files; reformatted the contract test); `flutter analyze --no-fatal-infos` (exit 0; 278 pre-existing infos); `flutter test` (1079 tests).
- PASS — `git diff --check`.
- PASS — GitNexus `detect_changes(scope: all)`: low risk, no affected processes. The index does not yet contain this untracked controller; pre-edit `retryPicker` impact was `UNKNOWN` with no callers.
- PASS — `tools/dev/sandbox.sh up && tools/dev/sandbox.sh status && tools/dev/sandbox.sh down`: sandbox started on API `:4098` and engine `:4097`, status reported both listeners, and cleanup removed the scoped sandbox directory.

## Notes

No WebView, PCO, MCP, Gallery, dependency, or API changes were made by this repair.
