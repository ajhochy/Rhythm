---
date: 2026-08-08
repo: Rhythm
branch: feat/artifact-viewer
pr: null
issues: [AV-04]
status: ready_for_verification
tags: [run, Rhythm]
---

## Files

- Backend user model/repository/controller validate and merge ordered per-user artifact-tab IDs.
- Flutter hosted artifact data/controller and Dashboard-only tab/picker workspace, with focused keyboard/race and production-theme golden coverage.
- `docs/ai/contracts/live-artifacts-av04.json` — AV-04 acceptance registry.

## Checks

- Required worktree/baseline verified: `/private/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/rhythm-artifact-viewer`, `feat/artifact-viewer`, `212f9f76f155def86aa67c810383e532b907d487`.
- `tools/dev/sandbox.sh up && tools/dev/sandbox.sh status` — PASS; API `:4098`, engine `:4097`.
- `PATH=/Users/ajhochhalter/development/flutter/bin:$PATH flutter test test/features/live_artifacts/av04_review_contract_test.dart` before repair — expected FAIL: no-HTML copy and raw fabricated session provenance assertions; close-during-load raised `RangeError` while writing a stale index.
- `cd apps/api_server && npx vitest run src/__tests__/live_artifacts_av04_preferences.test.ts && node_modules/.bin/tsc --noEmit && npm run build` — PASS (2 tests).
- `cd apps/api_server && RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 RHYTHM_LIVE_URL=http://127.0.0.1:4098 DB_PATH="$TMPDIR/rhythm-dev-sandbox/rhythm.db" RHYTHM_LIVE_DB_PATH="$TMPDIR/rhythm-dev-sandbox/rhythm.db" npx vitest run src/__tests__/live_artifacts_live_e2e.test.ts --no-file-parallelism` — PASS (2 tests).
- `cd apps/desktop_flutter && PATH=/Users/ajhochhalter/development/flutter/bin:$PATH dart format . --set-exit-if-changed && flutter analyze --no-fatal-infos && flutter test test/features/live_artifacts` — PASS (14 focused tests; 278 pre-existing infos).
- `cd apps/desktop_flutter && PATH=/Users/ajhochhalter/development/flutter/bin:$PATH flutter test test/features/live_artifacts/dashboard_artifact_tabs_test.dart --update-goldens` — PASS (5 tests), then focused tests rerun normally — PASS. Narrow long-title visible-focus light/dark goldens use `AppTheme` and disable the debug banner.
- `cd apps/desktop_flutter && PATH=/Users/ajhochhalter/development/flutter/bin:$PATH flutter test` — PASS (1063 tests).
- `cd apps/api_server && npx vitest run src/__tests__/live_artifacts_av04_preferences.test.ts && node_modules/.bin/tsc --noEmit && npm run build` — PASS (2 focused tests; typecheck/build clean).
- `cd apps/api_server && RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 RHYTHM_LIVE_URL=http://127.0.0.1:4098 DB_PATH="$TMPDIR/rhythm-dev-sandbox/rhythm.db" RHYTHM_LIVE_DB_PATH="$TMPDIR/rhythm-dev-sandbox/rhythm.db" npx vitest run src/__tests__/live_artifacts_live_e2e.test.ts --no-file-parallelism` — PASS (2 live preference tests).
- Final re-review contract, before repair: `cd apps/desktop_flutter && PATH=/Users/ajhochhalter/development/flutter/bin:$PATH flutter test test/features/live_artifacts/av04_review_contract_test.dart test/features/live_artifacts/dashboard_artifact_tabs_test.dart` — expected FAIL: old same-ID detail response replaced the new tab/reload response; Dashboard Left Arrow was ignored; new goldens were absent.
- `cd apps/desktop_flutter && PATH=/Users/ajhochhalter/development/flutter/bin:$PATH flutter test test/features/live_artifacts/dashboard_artifact_tabs_test.dart --update-goldens` — PASS (9 tests); generated and visually reviewed the production-AppTheme/debug-free empty-inventory, no-match/Clear-search, and conflict-recovery goldens.
- `cd apps/desktop_flutter && PATH=/Users/ajhochhalter/development/flutter/bin:$PATH dart format . --set-exit-if-changed && flutter test test/features/live_artifacts/av04_review_contract_test.dart test/features/live_artifacts/dashboard_artifact_tabs_test.dart` — PASS (20 tests).
- `cd apps/desktop_flutter && PATH=/Users/ajhochhalter/development/flutter/bin:$PATH flutter analyze --no-fatal-infos && flutter test` — PASS (1070 tests).
- `git diff --check` — PASS. `gitnexus_detect_changes(scope=all)` — LOW risk; its indexed-only report identifies the pre-existing tracked AV-04 integration files and no affected process. The final untracked artifact/controller test files are intentionally absent from this stale index.
- `tools/dev/sandbox.sh down` — PASS; isolated sandbox removed.

## Notes

GitNexus: `AppShell` upstream impact LOW (1 direct importer, no flows); Dashboard `_buildHeader` upstream impact LOW (2 direct callers, no flows). AV04 controller/tab symbols are new and unindexed, so their callers were manually traced in `DashboardArtifactWorkspace`/`AppShell` before editing.

Review repair: toolbar now owns the single Planning badge while Dashboard's default remains unchanged elsewhere; the picker has factual date/no-results copy; tab controls are 44px and one keyboard stop; picker selection has explicit focus; stale response writes are ID/generation/user guarded; conflicts offer refresh. No WebView, bridge, PCO, MCP, Gallery, reorder, rename, active-tab persistence, or new dependency was introduced. AV-06 native runtime screenshot: **deferred to AV-06** — AV-04 deliberately has no native/WebView viewer.

Final re-review repair: each tab instance/load now carries a monotonic request token, so close/reopen and same-tab reload invalidate every older response. Dashboard Left Arrow now wraps to the final artifact and all arrow routes preserve focus. Conflict Refresh is widget-proven to retry, render loading, then render recovered content; generic errors have no conflict action. Backend/static/live checks were not rerun because this pass changed no backend files.

## Exceptional final AV-04 repair

- Acceptance contract initially failed as intended: signed-out workspace rendered `A private artifact`; close/reopen created 3 concurrent preference PATCHes; delayed persistence left focus on the removed tab.
- `LiveArtifactsController` is now workspace-owned below the authentication boundary. Identity changes synchronously reset tabs, selection, inventory, picker/error state, and invalidate stale loads/saves before deferred restore; Dashboard remains selected on restore.
- Preference mutations serialize through the current user/generation queue, retaining the latest local order after a failed request. Close and picker selection update focus before persistence; the selected-tab focus is scheduled for the next local frame only so its newly built focus node is attached, never on PATCH completion.
- `flutter test test/features/live_artifacts/av04_final_repair_contract_test.dart test/features/live_artifacts/av04_review_contract_test.dart test/features/live_artifacts/dashboard_artifact_tabs_test.dart` — PASS (25 tests). The new deterministic contract covers A→logout, A→B deferred response discard, delayed close/reopen ordering, failed-then-latest save, and delayed-PATCH close/picker focus.
- `dart format . --set-exit-if-changed && flutter analyze --no-fatal-infos && flutter test` — PASS (1076 tests; 278 pre-existing infos).
- `tools/dev/sandbox.sh up && tools/dev/sandbox.sh status && tools/dev/sandbox.sh down` — PASS; sandbox removed. Backend code unchanged by this repair.
- `git diff --check` — PASS. `gitnexus_detect_changes(scope=all)` — LOW; index reports only pre-existing tracked AV-04 symbols, while final controller/widget/test files remain unindexed.
