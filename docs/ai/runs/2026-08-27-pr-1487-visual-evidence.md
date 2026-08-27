---
date: 2026-08-27
repo: Rhythm
branch: fix/bridge-stream-reliability-repair
pr: 1487
issues: [1457, 1487]
status: ready_for_verification
tags: [run, Rhythm]
---

# PR #1487 reconnect banner visual evidence

## Files

- `apps/desktop_flutter/test/features/agents/issue_1457_bridge_status_indicator_test.dart`
  - Uses the shipping `AgentsView` harness at 1400x900, the production light theme, and the bundled Inter font.
  - Captures the reconnecting state before asserting recovery clears the banner and leaves sessions non-error.
- `apps/desktop_flutter/test/features/agents/goldens/issue_1457_bridge_reconnecting.png`
  - 1400x900 PNG, SHA-256 `cc440da5b35eb79c921c45e507d1580b2e574e7cdc24f6d5a28774d0cd24263e`.

## Checks

- Initial `flutter test --update-goldens ...` attempt: command unavailable on the non-login PATH (`flutter: command not found`); no artifact produced by that attempt.
- `/Users/ajhochhalter/development/flutter/bin/flutter test --update-goldens test/features/agents/issue_1457_bridge_status_indicator_test.dart --plain-name "issue-1457-c5: bridge outage shows reconnecting without failing sessions and recovery clears it"` — PASS; focused PNG generated with the repo-resolved Flutter dependencies.
- `/Users/ajhochhalter/development/flutter/bin/flutter test test/features/agents/issue_1457_bridge_status_indicator_test.dart --plain-name "issue-1457-c5: bridge outage shows reconnecting without failing sessions and recovery clears it"` — PASS; normal comparator accepted the committed golden.
- `/Users/ajhochhalter/development/flutter/bin/dart format test/features/agents/issue_1457_bridge_status_indicator_test.dart` — PASS, 0 changed.
- `/Users/ajhochhalter/development/flutter/bin/dart format . --set-exit-if-changed` — PASS, 519 files checked, 0 changed.
- `/Users/ajhochhalter/development/flutter/bin/flutter analyze --no-fatal-infos` — PASS, exit 0 with 318 pre-existing infos.
- `shasum -a 256 ... && sips -g pixelWidth -g pixelHeight ...` — PASS; nonempty 1400x900 PNG and hash above.
- `gitnexus_detect_changes(scope: all)` — attempted; unavailable for the same LadybugDB storage-version mismatch noted below.

## Notes

WAIVED: test-only visual evidence adds no production behavior; verification is a focused shipping-surface golden update followed by a normal comparator pass, formatting, analysis, and artifact hash validation.
- The shipping app and sandbox must not be launched.
- Neither was launched.
- Existing verifier evidence files are preserved and excluded from this run's commit.
- GitNexus impact/context was attempted before editing, but the index was unavailable because its LadybugDB storage version (42) differs from the connected build (41). No production symbol was edited.
