---
date: 2026-08-10
repo: Rhythm
branch: feat/artifact-viewer
pr: 1338
issues: []
status: ready_for_verification
tags: [run, rhythm, flutter, live-artifacts, import]
---

## Files

- Preserved selected UTF-8 HTML source verbatim in `bundle.html` and leave `bundle.css`/`bundle.js` empty.
- Added a non-mutating preview analyzer: curated Google Fonts, cdnjs, jsDelivr, and unpkg resources are quiet; other external resources and network APIs warn.
- Repaired the AV-06 native smoke workspace constructor with `workspaceId: int.parse(_workspace)`.

## Acceptance contract

- `docs/ai/contracts/live-artifacts-import.json`
- Initial failing command: `cd apps/desktop_flutter && /Users/ajhochhalter/development/flutter/bin/flutter test test/features/live_artifacts/import_share_contract_test.dart`
  - Failed as required: standalone document was reduced to its body, the analyzer did not report the required allowlist-aware warning, and a fragment lost inline style/script content.
- Final command: `cd apps/desktop_flutter && /Users/ajhochhalter/development/flutter/bin/flutter test test/features/live_artifacts/import_share_contract_test.dart` — PASS (13 tests).

## Checks

- `/Users/ajhochhalter/development/flutter/bin/flutter --version` — PASS (Flutter 3.41.6).
- `cd apps/desktop_flutter && /Users/ajhochhalter/development/flutter/bin/dart format --set-exit-if-changed lib/features/live_artifacts/services/html_import_analyzer.dart lib/features/live_artifacts/services/html_import_decomposer.dart lib/features/live_artifacts/widgets/dashboard_artifact_tabs.dart integration_test/live_artifacts_av06_native_smoke_test.dart test/features/live_artifacts/import_share_contract_test.dart` — PASS.
- `cd apps/desktop_flutter && /Users/ajhochhalter/development/flutter/bin/flutter test test/features/live_artifacts` — PASS (61 tests).
- `cd apps/desktop_flutter && /Users/ajhochhalter/development/flutter/bin/flutter analyze --no-fatal-infos` — PASS (296 pre-existing/non-fatal infos).

## Notes

- Native file-picker/path smoke remains manual (`live-artifacts-import-c2`, `live-artifacts-import-c8`).
- The AV-06 native integration fixture was compiled by `flutter analyze`; it was not run because it requires the documented isolated sandbox credentials and fixture endpoints.
- GitNexus queries/impacts did not resolve the branch-new Flutter symbols in the stale index; no HIGH/CRITICAL result was returned.
