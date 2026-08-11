---
date: 2026-08-09
repo: Rhythm
branch: feat/artifact-viewer
pr: null
issues: [AV-06]
status: BLOCKED
tags: [run, Rhythm, live-artifacts]
---

# AV-06 secure native runtime

## Files

- `docs/ai/contracts/live-artifacts-av06.json`
- Flutter runtime/bridge/data-source/model/view changes and official
  `webview_flutter 4.14.1` resolution (including generated macOS registration).
- Server render bootstrap contract/test change.

## Contract

The initial UI contract was intentionally red before runtime implementation:

```text
PATH="/Users/ajhochhalter/development/flutter/bin:$PATH" flutter test test/features/live_artifacts/av06_runtime_contract_test.dart
Expected: exactly one matching candidate
Actual: Found 0 widgets
```

The server bootstrap contract was also red before its handler change:

```text
npx vitest run src/__tests__/live_artifacts.test.ts
AssertionError: expected -1 to be greater than -1
```

The meta-CSP repair contract was red before the render change:

```text
npx vitest run src/__tests__/live_artifacts.test.ts
AssertionError: expected -1 to be greater than 21
```

## Official package evidence

`webview_flutter_wkwebview 3.25.1` is now a direct dependency without changing
the resolved `webview_flutter 4.14.1` version. Its installed official source
documents `WebKitWebViewControllerCreationParams` for window/media policy,
`WebViewController.fromPlatformCreationParams(... onPermissionRequest:)`,
`setAllowsBackForwardNavigationGestures`, `setInspectable`, and WebKit-backed
cache/local-storage clearing. The platform implementation's `onCreateWebView`
does not create a main-frame popup; this runtime also sets JavaScript automatic
window opening to false and denies all permission requests.

## Checks

- `flutter pub get` — pass; lock marks `webview_flutter_wkwebview 3.25.1` direct
  main and resolves no new package version.
- `flutter test test/features/live_artifacts/av06_runtime_contract_test.dart` —
  pass.
- `npx vitest run src/__tests__/live_artifacts.test.ts` — 25 pass.
- `node_modules/.bin/tsc --noEmit` — pass.
- `flutter analyze --no-fatal-infos` — exit 0 (278 pre-existing info diagnostics;
  none in `live_artifact_view.dart`).
- `flutter build macos` — pass; produced release `Rhythm.app`.
- `bun run build --single` (fork), `npm run build` (api), and scoped
  `tools/dev/sandbox.sh up/status` — pass; sandbox API `:4098`, engine `:4097`.

## Blocked validation

The direct official API repair is compiled and packaged, but the required native
integration test A1–A10 has not been written or run. Consequently there is no
sandbox-driven visible render, revision 1→2 bridge proof, hostile fixture result,
or screenshot. Downloads/file chooser absence is source-level fail-closed evidence
only, not native behavioral proof. No security criterion is waived.

## Triage update — native harness now launches; A1–A10 pass

Supersedes the "signing blocker" above: **there is no signing defect.** The
reported "missing Mac Development certificate for team 56Q69NYP9H" was an
artifact of running the Flutter toolchain with `HOME` redirected to
`$TMPDIR/rhythm-av06-native-home`. That redirect caused two failures at once:

1. `flutter pub get` wrote `.dart_tool/package_config.json` with absolute paths
   into a throwaway `$TMPDIR/rhythm-av06-native-home/.pub-cache`. When the temp
   HOME was cleaned up, every third-party package path dangled, so the Dart
   kernel build failed inside Flutter's own sources
   (`Undefined name 'Matrix4'`, `MapEquality ... Not a constant expression`) —
   `Target kernel_snapshot_program failed`, never reaching a signing step.
2. A redirected HOME has no login keychain, so Xcode automatic signing could not
   see the real `Apple Development` / `Developer ID` identities.

Repair: `flutter pub get` under the real `HOME`. No tracked file changed
(`.dart_tool/` is gitignored). `macos/Runner.xcodeproj/project.pbxproj` and all
xcconfigs are untouched; Release keeps `DEVELOPMENT_TEAM = 56Q69NYP9H` and
`CODE_SIGN_STYLE = Automatic`. **Never set `HOME` for `flutter` commands** —
`tools/dev/sandbox.sh` redirects HOME for the api_server/engine only.

A second, unrelated harness defect then surfaced: the smoke drove promise-based
JS through `runJavaScriptReturningResult`, which maps to WKWebView
`evaluateJavaScript` — not an async context (top-level `await` is a SyntaxError)
and unable to marshal a `Promise` or `undefined`. Fixed in the test with two
helpers: `jsVoid` (statements, via `runJavaScript`) and `jsAsync`
(promise-producing expressions settle onto `window.av06.r`, then polled).

### Checks

```text
tools/dev/sandbox.sh up            # API :4098, engine :4097 (RHYTHM_SANDBOX_DIR=$TMPDIR/rhythm-av06-sandbox)
node tools/dev/av06_native_fixture.mjs "$SB/rhythm.db" "$SB/av06.env" "$SB/av06-evidence.json"
RHYTHM_LIVE_E2E=1 RHYTHM_PCO_LIVE_BASE_URL=http://127.0.0.1:4199   # exported before sandbox up

flutter test integration_test/live_artifacts_av06_native_smoke_test.dart -d macos \
  --dart-define=AV06_API_URL=http://127.0.0.1:4098 \
   --dart-define=AV06_TOKEN=$AV06_TOKEN \
   --dart-define=AV06_WORKSPACE_ID=$AV06_WORKSPACE_ID \
   --dart-define=AV06_PCO_COUNTER_URL=http://127.0.0.1:4199/_av06/counters
```

- Native launch: **achieved** — `✓ Built build/macos/Build/Products/Debug/Rhythm.app`,
  Dart test body executes in-process in the real app.
- A1–A10: **all pass.** Execution reached line 152 (`takeScreenshot`), which sits
  after every assertion on lines 70–150; no assertion threw.
- PCO fixture evidence: `{"requests":1,"correctBearer":true,"forbiddenPath":false}`
  — the capability broker used the viewer's own token and requested no
  token/state/bundle/worktree path.
- `dart format . --set-exit-if-changed` — 457 files, 0 changed.
- `flutter analyze --no-fatal-infos integration_test/live_artifacts_av06_native_smoke_test.dart`
  — No issues found.
- Sandbox and fixture torn down; `pod install` UUID churn in `project.pbxproj`
  reverted. Live desktop engine on :4096 untouched throughout.

### Still blocked: the screenshot

`IntegrationTestWidgetsFlutterBinding.takeScreenshot` cannot work on macOS:

```text
MissingPluginException(No implementation found for method captureScreenshot
on channel plugins.flutter.io/integration_test)
```

`integration_test/pubspec.yaml` declares plugin platforms `android` and `ios`
only, and the macOS implementation
(`integration_test_macos/.../IntegrationTestPlugin.swift`) handles
**`allTestsFinished` and nothing else** — `captureScreenshot` returns
`FlutterMethodNotImplemented`. This is an upstream Flutter SDK limitation, not a
Rhythm defect.

OS-level capture is also unavailable: `screencapture -x` fails with
`could not create image from display` (exit 1) because Screen Recording (TCC) is
not granted, and granting it is a global machine-config change requiring user
interaction. A Flutter-side `RepaintBoundary` raster is not viable either — the
WKWebView is a native platform view and rasterises as a hole, so it would not
prove web content rendered.

Recommended repair (additive product change, deliberately **not** made during
triage): add a `WKWebView.takeSnapshot(with:completionHandler:)` bridge in the
macOS Runner, following the existing `HumanApprovalSigner.swift` precedent —
`FlutterMethodChannel` on `controller.engine.binaryMessenger`, registered from
`MainFlutterWindow.awakeFromNib`. It captures the real WebKit surface, needs no
TCC permission, works while the window is not foregrounded (the harness logs
`Failed to foreground app; open returned 1`), and touches no signing setting.
The test would call that channel instead of `binding.takeScreenshot` and write
the PNG under `docs/testing/results/`.

## Final-review continuation

- Added the DEBUG-only `captureWindow` method to the existing snapshot channel.
  It captures this app's `NSWindow` with `CGWindowListCreateImage` and accepts
  no window/path argument. `MainFlutterWindow` remains DEBUG registration only;
  there is no release channel or startup behavior change.
  **Superseded** — `captureWindow` mis-composed the snapshot and was removed; the
  window image is now composed in the test. See the composition triage section in
  `docs/ai/runs/2026-08-09-av06-native-snapshot-attempt.md`.
- Added display-safe `updatedByDisplayName` by joining `users.name` inside the
  live-artifact repository. Public live-artifact responses omit
  `updatedByUserId`; Flutter no longer models it. The toolbar now uses locale
  date formatting and safely omits a missing name.
- Added a one-way, allowlisted `host.blocked` notification with a two-second
  host-side coalesce and a fixed nonblocking message. It makes no API/host
  request. WebKit permission requests notify then deny.
- Reload now maps 410/deleted (Remove tab), 409/conflict (Refresh), 403/404
  unavailable, and generic Retry copy within the viewer, matching tab states.

### Contract and focused checks

The new provenance widget contract failed before implementation:

```text
Expected: exactly one matching candidate
Actual: Found 0 widgets with text "Updated Aug 9, 2026 · Bundle 1 · State 2"
```

After implementation:

- `flutter test test/features/live_artifacts/av06_runtime_contract_test.dart` —
  **2 passed**.
- `npx vitest run src/__tests__/live_artifacts.test.ts` — **26 passed**.
- `node_modules/.bin/tsc --noEmit` — **pass**.
- focused `flutter analyze --no-fatal-infos` — exit 0 with four pre-existing/
  style info diagnostics in `live_artifact_view.dart`; no errors.
- `git diff --check` — pass. `gitnexus_detect_changes(scope: all)` reported
  low risk and only the existing DEBUG `MainFlutterWindow.awakeFromNib` indexed.

### Remaining gate failures

No production-looking full-window screenshot has been captured or hashed, and
the native smoke still mounts `LiveArtifactView` instead of the production
Dashboard workspace. The real native focus/edit/select/scroll path, explicit
gesture-feedback smoke, full Flutter suite/builds, sandbox/live rerun, release
absence proof, and fixture-cleanup-zero proof remain unrun. This run is not
ready for verification.

### AV06 full-window continuation — BLOCKED

The harness now mounts production `AppTheme` `DashboardArtifactWorkspace` with
the real Planning/Dashboard/artifact/+ strip, toolbar metadata/Reload, and a
clean interactive Worship Calendar fixture. It retains A1–A10, state 1→2,
current-user PCO projection/bearer proof, debounced blocked feedback for link,
form, download, file, and media attempts, and native focus/edit/selection/
vertical scroll-return assertions.

Exact native command (Flutter used the real HOME; only API/engine used the
sandbox):

```sh
RHYTHM_SANDBOX_DIR="$TMPDIR/opencode/rhythm-av06-full-window" \
  RHYTHM_LIVE_E2E=1 RHYTHM_PCO_LIVE_BASE_URL=http://127.0.0.1:4199 \
  tools/dev/sandbox.sh up
node tools/dev/av06_native_fixture.mjs "$SB/rhythm.db" "$SB/av06.env" "$SB/av06-evidence.json" &
PATH="/Users/ajhochhalter/development/flutter/bin:$PATH" RHYTHM_LIVE_E2E=1 \
  flutter test integration_test/live_artifacts_av06_native_smoke_test.dart -d macos \
  --dart-define=AV06_API_URL=http://127.0.0.1:4098 \
  --dart-define=AV06_TOKEN="$AV06_TOKEN" \
   --dart-define=AV06_WORKSPACE_ID="$AV06_WORKSPACE_ID" \
   --dart-define=AV06_EVIDENCE_PATH="<worktree>/docs/ai/runs/evidence/av06-dashboard-artifact.png" \
   --dart-define=AV06_SECURITY_EVIDENCE_PATH="<worktree>/docs/ai/runs/evidence/av06-native-artifact.png" \
   --dart-define=AV06_PCO_COUNTER_URL=http://127.0.0.1:4199/_av06/counters
```

- Native test passed: `00:07 +1: All tests passed!`.
- PCO fixture cleanup evidence: `{"requests":1,"correctBearer":true,"forbiddenPath":false}`;
  sandbox teardown left `:4097`, `:4098`, and `:4199` free.
- Security PNG: `1440×751`, `82,253` bytes,
  SHA-256 `82e8f338b003b83f3c5f0305d102aad7eb08d83458efa77454d4d5bd785a3d56`.
- **Failing probe:** composited full-window PNG is structurally valid
  (`1440×893`, `88,264` bytes,
  SHA-256 `ba40b3590e5f237fa7ecc13ee43ac667a0cffaf1312f19c9e23a2b5fde699dc9`)
  but visually contains only the WKWebView fixture and the raw black platform
  view region. It omits Planning/Dashboard/artifact/+ and the viewer toolbar.
  `CGWindowListCreateImage` omits the platform view; the DEBUG compositor's
  descendant lookup/placement does not yet overlay it into that image.

No waiver was used. `av06-review-c1` remains `failing`, and the contract is
not eligible to mark AV06 complete. Focused Flutter contract/analyzer passed;
API build and fork build passed. The live API e2e command was correctly refused
by its isolation guard because the Vitest process did not inherit sandbox
`DB_PATH`; it was not counted as a live pass. `git diff --check` passed.

## AV06 evidence-consistency continuation — BLOCKED

### Acceptance contract

The added deterministic reload contract was run before the evidence correction:

```text
flutter test test/features/live_artifacts/av06_runtime_contract_test.dart
AV-06-review-c3: conflict reload exposes Refresh artifact
Expected: <2>
Actual: <1>
```

The unavailable (403/404), deleted/remove, generic/retry-and-recovery cases pass,
but the injected HTTP seam does not observe the conflict refresh's second hosted
read. This must be resolved before the review-c3 anchor can be marked pass.

The native smoke now has counter hooks and an explicit PCO-counter endpoint for
the required blocked-action proof, but it has not been run after those additions.

physical hardware key synthesis is unavailable/not exercised in Flutter macOS integration harness; automated evidence covers native WebKit focus/editing via insertText/editing path, non-empty selection, vertical scroll and return. Do not claim physical keyboard.
