---
date: 2026-08-10
repo: Rhythm
branch: feat/artifact-viewer
pr: 1338
issues: [1339]
status: blocked
tags: [run, rhythm, flutter, live-artifacts]
---

## Files

- Added owner/workspace/visibility metadata, import validation/preview, hosted sharing calls, and stateful sharing UI in the existing Flutter live-artifact files.
- Replaced the presence-only import/share contract with behavioral MockClient/widget tests.
- Reconciled import and #1339 contracts; native picker/path and shipping-app smoke remain manual.

## Checks

- Initial acceptance run (expected failure): `cd apps/desktop_flutter && flutter test test/features/live_artifacts/import_share_contract_test.dart` — 3 failures: missing explicit `visibility: private`, missing human sharing status, and no visibility PATCH.
- `cd apps/desktop_flutter && flutter test test/features/live_artifacts/import_share_contract_test.dart` — PASS, 9 tests.
- `cd apps/desktop_flutter && flutter test test/features/live_artifacts/` — PASS, 57 tests; existing goldens passed without updates.
- `cd apps/desktop_flutter && dart format . --set-exit-if-changed` — PASS.
- `cd apps/desktop_flutter && flutter analyze --no-fatal-infos` — PASS (pre-existing info diagnostics only).

## Notes

- `GET /users` is fetched once per dialog; mutations refresh artifact metadata and collaborators.
- The import cap is 900 KiB, leaving JSON-envelope headroom below the API's 1 MiB request ceiling.
- Not run: native macOS picker and end-to-end shipping-app smoke; orchestrator owns those manual checks.

## Repair Slice F — standalone HTML decomposition

- Acceptance failure recorded before implementation: `flutter test test/features/live_artifacts/import_share_contract_test.dart` failed `standalone documents become an executable bundle` because `preview.html` still contained `window.calendarData` from an executable body script.
- Added a pure regex decomposer. It separates CSS and executable inline scripts, preserves JSON/data scripts in body HTML, reports discarded external resources/head metadata, and explicitly notes module-to-classic script downgrade. Import sends the resulting `{html, css, js}` bundle.
- `flutter test test/features/live_artifacts/` — PASS, 60 tests.
- `dart format . --set-exit-if-changed` — PASS, 461 files unchanged after formatting.
- `flutter analyze --no-fatal-infos` — BLOCKED by pre-existing/out-of-slice error: `integration_test/live_artifacts_av06_native_smoke_test.dart:168` constructs `DashboardArtifactWorkspace` without its required `workspaceId`; 301 total diagnostics include this one error. No integration-test or model edits were made by this slice.
- GitNexus impact for `HtmlImportPreview` and `DashboardArtifactWorkspace` returned no symbol / zero consumers (stale branch-new index); treated as LOW and recorded before edits.
- `gitnexus_detect_changes(scope: unstaged)` reports LOW risk and no affected processes, but its two indexed symbols are concurrent api-server work from the shared dirty worktree; the branch-new Flutter decomposer is absent from the stale index.
