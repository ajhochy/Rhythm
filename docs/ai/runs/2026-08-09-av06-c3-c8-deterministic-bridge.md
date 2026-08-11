---
date: 2026-08-09
repo: Rhythm
branch: feat/artifact-viewer
pr: null
issues: [AV-06]
status: READY_FOR_VERIFICATION
tags: [run, desktop_flutter, live-artifacts, av06]
---

## Contract

WAIVED: product behavior is unchanged; verification is: focused LiveArtifactBridge unit contracts plus the full live_artifacts Flutter directory.

- Supplemental waiver: `docs/ai/contracts/live-artifacts-av06-c3-c8-evidence.json`.
- Reconciled `docs/ai/contracts/live-artifacts-av06.json`: C3 is now the nine-test bridge boundary/host-blocked proof; C8 is now the seven-test deterministic boundary proof.
- The initial focused run failed the stale-completion assertion: expected `{'title': 'before'}`, actual `{'title': 'stale'}`. This proved a product defect, so the bridge now checks its existing `isCurrent(generation)` seam before publishing an update result.

## Files changed

- `apps/desktop_flutter/lib/features/live_artifacts/services/live_artifact_bridge.dart`
- `apps/desktop_flutter/test/features/live_artifacts/av06_runtime_contract_test.dart`
- `docs/ai/contracts/live-artifacts-av06.json`
- `docs/ai/contracts/live-artifacts-av06-c3-c8-evidence.json`
- this run note

## Checks run

- `flutter test test/features/live_artifacts/av06_runtime_contract_test.dart` — initial 15 pass / 2 fail (test fixture record-type assertion and stale state mutation); after the fixture correction and product stale/PCO guards, **17/17 pass**.
- `flutter test test/features/live_artifacts/av06_runtime_contract_test.dart --plain-name 'rejects a duplicate pending ID without a second call'` with the duplicate guard temporarily removed — failed (timeout; second pending request was not rejected). Guard restored.
- `flutter test test/features/live_artifacts/av06_runtime_contract_test.dart --plain-name 'enforces eight pending requests, then releases capacity on completion'` with the inflight guard temporarily removed — failed: expected 8 data calls, actual 9. Guard restored.
- `flutter test test/features/live_artifacts/av06_runtime_contract_test.dart --plain-name 'discards updates completed after every lifecycle identity change'` with the stale guard temporarily removed — failed: expected `{'title': 'before'}`, actual `{'title': 'stale'}`. Guard restored.
- `dart format . --set-exit-if-changed` — 457 files, 0 changed.
- `flutter analyze --no-fatal-infos` — exit 0; pre-existing info diagnostics only.
- `flutter test test/features/live_artifacts` — **48/48 pass**.
- `flutter test` — **1097/1097 pass**.
- `gitnexus_detect_changes(scope: compare, base_ref: a48e3448)` — LOW; 2 indexed startup symbols, 0 affected processes. The supplied prior pre-impact remains HIGH / 16 direct items; this compare result is only the post-change index view.

## Notes

- Native smoke was not rerun: this is bridge lifecycle validation, not a native navigation/runtime policy change.
- The new PCO request shape guard admits only the already server-allowed `list_service_types`, `list_plans`, and `list_plan_items` bodies; URL/header/token/file/process/method extras do not reach the data source.
