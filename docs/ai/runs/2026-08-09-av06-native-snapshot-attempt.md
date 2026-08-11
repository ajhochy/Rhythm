---
date: 2026-08-09
repo: Rhythm
branch: feat/artifact-viewer
pr: null
issues: [AV-06]
status: PASS
tags: [run, Rhythm, live-artifacts, native]
---

# AV-06 native snapshot attempt

## Files

- `apps/desktop_flutter/macos/Runner/ArtifactSnapshotter.swift`
- `apps/desktop_flutter/macos/Runner/MainFlutterWindow.swift`
- `apps/desktop_flutter/macos/Runner.xcodeproj/project.pbxproj`
- `apps/desktop_flutter/integration_test/live_artifacts_av06_native_smoke_test.dart`

## Contract

The live contract now calls `com.vcrc.rhythm/artifact-snapshot` after A1–A10,
requires PNG signature/IHDR dimensions/a nontrivial byte size, and writes only
to the absolute `AV06_EVIDENCE_PATH`. Before the helper was added, the sandbox
run failed before the capture call at the pre-existing combined bridge assertion:

```text
Expected: contains '"stateRevision":2'
Actual: 'ERR:[object Object]'
```

The same failure remained after the DEBUG-only helper was compiled into the
Debug app, so no screenshot was produced and the AV06 contract remains failing.

## Checks

- `flutter test test/features/live_artifacts/av06_runtime_contract_test.dart` — pass.
- `npx vitest run src/__tests__/live_artifacts.test.ts` — 25 pass.
- `flutter build macos` — pass (Release app).
- `flutter analyze --no-fatal-infos integration_test/live_artifacts_av06_native_smoke_test.dart` — exit 0; removed the sole unnecessary-import info afterward.
- Sandbox fixture/native command — Debug app built and launched under real HOME; failed at the state/PCO bridge assertion above before capture. Sandbox and fixture were torn down; ports 4097/4098 were sandbox-owned.
- `git diff --check` — pass. `project.pbxproj` contains only the new Swift source reference/build-file entries; signing configs and entitlements are unchanged.
- `gitnexus_detect_changes(scope: all)` — 2 changed indexed symbols, 0 affected processes; the required pre-edit `MainFlutterWindow` impact was HIGH (16 direct dependents).

## Notes

- No signing, global keychain, TCC, entitlements, or release registration changes.

## Triage update — A1–A10 and the native capture both pass

Supersedes the BLOCKED conclusion above. **There is no product defect.** The
`ERR:[object Object]` failure was a *harness-legibility* defect on top of an
unwired fixture environment, and two claims in the section above were wrong:
the sandbox/fixture were **not** torn down (the orphaned
`rhythm-av06-sandbox/api_server.pid` from 14:52 survived, which makes any later
`sandbox.sh up` fail fast at its PID-file guard), and the DEBUG helper is fine.

Root cause: `window.av06.bridge()` awaits three legs — `state.get`,
`state.update`, `pco.services.read` — and returns one combined object, so **any**
leg's rejection failed the `contains('"stateRevision":2')` matcher. The rendered
bootstrap rejects with `reject(x.error)`, i.e. `{code}` with **no `message`**, so
the harness's `"ERR:"+((e&&e.message)||e)` stringified an object to the literal
`[object Object]`. The state update was never the failure; only the PCO leg has
an external dependency (fixture on `:4199` + `RHYTHM_PCO_LIVE_BASE_URL` exported
*before* `sandbox.sh up`, since `pcoReadBaseUrl()` gates on `RHYTHM_LIVE_E2E`).

Harness repair (test-only, `integration_test/live_artifacts_av06_native_smoke_test.dart`):
per-leg step tagging in the fixture bundle's `bridge()`, `JSON.stringify` of the
rejected object, and an `isNot(startsWith('ERR:'))` guard asserted *before* the
revision matcher so a rejected leg can never again read as a state failure.

### Checks

```text
tools/dev/sandbox.sh up            # API :4098, engine :4097; RHYTHM_LIVE_E2E=1 +
                                   # RHYTHM_PCO_LIVE_BASE_URL=http://127.0.0.1:4199 exported first
node tools/dev/av06_native_fixture.mjs "$SB/rhythm.db" "$SB/av06.env" "$SB/av06-evidence.json"
flutter test integration_test/live_artifacts_av06_native_smoke_test.dart -d macos \
  --dart-define=AV06_API_URL=http://127.0.0.1:4098 --dart-define=AV06_TOKEN=… \
   --dart-define=AV06_WORKSPACE_ID=… --dart-define=AV06_EVIDENCE_PATH="$SB/av06-native-artifact.png" \
   --dart-define=AV06_PCO_COUNTER_URL=http://127.0.0.1:4199/_av06/counters
```

- Native smoke: **pass** — `00:06 +1: All tests passed!` (exit 0), twice.
- **Capture reached and verified:** PNG `1440 x 797`, 8-bit RGBA, 34,514 bytes,
  `sha256 2cec4273c7d60011b2129b3b6d61ed7f99a6d59d4799db8ec75663c77f3a77be`
  (identical across runs). Taken via `WKWebView.takeSnapshot`, no TCC prompt,
  window not foregrounded (`Failed to foreground app; open returned 1`).
- API layer probed directly first: create `201`, `GET` revision `1`,
  `PUT /state` expected=1 → `200` revision **2**, capability → `200`
  `{"data":[{"id":"st-av06","name":"Live Sunday"}]}`, delete `204`. No 409, no
  validation/auth/rate-limit defect.
- Negative attribution test (capability undeclared, then reverted): fails as
  `ERR:{"message":"pco.services.read:request_failed"…}` — the leg is now named,
  and `state.update` had already reached revision 2, proving the misattribution.
- PCO fixture evidence: `{"requests":8,"correctBearer":true,"forbiddenPath":false}`.
- `dart format . --set-exit-if-changed` — 457 files, 0 changed.
  `flutter analyze --no-fatal-infos <smoke test>` — No issues found.
- `flutter build macos` — pass (Release, 72.3 MB). Release binary contains
  `human-approval` but **not** `artifact-snapshot`: the `#if DEBUG` guard keeps
  the evidence bridge out of the shipping app. `project.pbxproj` diff is exactly
  4 additive lines, no pod UUID churn after four Debug builds.
- Sandbox + fixture torn down; `:4097/:4098/:4099/:4199` free; the desktop
  engine on `:4096` was untouched throughout (same PID before and after).

### Known fixture defect (separate, not blocking)

`tools/dev/av06_native_fixture.mjs:42` — `DELETE FROM workspaces` fails with
`SQLITE_CONSTRAINT_FOREIGNKEY` because `DELETE /live-artifacts/:id` is a **soft**
delete, so the tombstoned row keeps referencing the workspace. The whole cleanup
transaction rolls back, leaking the AV06 user/session/workspace/membership and
the fake-token `integration_accounts` row, and the fixture exits non-zero.
Harmless while the sandbox dir is `rm -rf`'d by `sandbox.sh down`, but it silently
undoes the fixture's own teardown. Smallest fix: delete the artifact rows (or
their revision children first) inside that transaction before the workspace.

- Evidence PNG + logs preserved outside the sandbox at
  `$TMPDIR/opencode/av06-triage-evidence/`; promote to
  `docs/ai/runs/evidence/av06-native-artifact.png` when the owner wants it tracked.

## Closeout — fresh tracked evidence and fixture cleanup

- `tools/dev/av06_native_fixture.mjs` now removes only rows tied to its generated
  AV06 user/workspace/token markers. It removes collaborators, bundle revisions,
  state revisions, and the soft-deleted artifact before membership/workspace/user
  rows, then asserts all marker counts and the fake PCO-token account are zero.
  SIGINT, SIGTERM, uncaught exceptions, and unhandled rejections share that cleanup.
- Fresh (not copied) native evidence: `docs/ai/runs/evidence/av06-native-artifact.png`.
  SHA-256 `2cec4273c7d60011b2129b3b6d61ed7f99a6d59d4799db8ec75663c77f3a77be`;
  1440×797; 34,514 bytes; PNG signature/IHDR and >10 KiB are asserted by the test.
- Fresh sandbox command used `RHYTHM_LIVE_E2E=1` and
  `RHYTHM_PCO_LIVE_BASE_URL=http://127.0.0.1:4199` before `sandbox.sh up`; the
  Flutter integration test ran under the real HOME with the exact absolute PNG path.
  A1–A10 passed (`00:06 +1: All tests passed!`), including bridge state revision
  1→2 and the retained per-leg no-`ERR:` assertion before revision matching.
- Fixture evidence: `{"requests":1,"correctBearer":true,"forbiddenPath":false}`.
  The run rejected any fake PCO token occurrence in the PNG, native log, or API log.
  Direct post-cleanup marker counts were all zero for artifacts, bundle/state revisions,
  collaborators, users, sessions, workspaces, and integration accounts.
- Focused checks: API `live_artifacts.test.ts` 25/25; Flutter AV06 runtime contract
  pass; native analyzer clean; `dart format . --set-exit-if-changed` 0 changes;
  `flutter build macos --release` pass. The Release binary lacks `artifact-snapshot`
  and retains `human-approval`. `project.pbxproj` has exactly four additive
  `ArtifactSnapshotter.swift` references/build-file lines; no signing change.

### Exact fresh-run commands and log checks

```sh
export SB="$TMPDIR/opencode/rhythm-av06-evidence"
RHYTHM_SANDBOX_DIR="$SB" RHYTHM_LIVE_E2E=1 \
  RHYTHM_PCO_LIVE_BASE_URL=http://127.0.0.1:4199 tools/dev/sandbox.sh up
node tools/dev/av06_native_fixture.mjs "$SB/rhythm.db" "$SB/av06.env" "$SB/av06-evidence.json" &
source "$SB/av06.env" # mode 0600; token never printed
cd apps/desktop_flutter
RHYTHM_LIVE_E2E=1 flutter test integration_test/live_artifacts_av06_native_smoke_test.dart -d macos \
  --dart-define=AV06_API_URL=http://127.0.0.1:4098 \
  --dart-define=AV06_TOKEN="$AV06_TOKEN" \
   --dart-define=AV06_WORKSPACE_ID="$AV06_WORKSPACE_ID" \
   --dart-define=AV06_EVIDENCE_PATH="<worktree>/docs/ai/runs/evidence/av06-native-artifact.png" \
   --dart-define=AV06_PCO_COUNTER_URL=http://127.0.0.1:4199/_av06/counters
```

`native.log` had no `ERR:` before the revision matcher and neither it, the API
log, nor the PNG contained the captured fake token. `file`, `sips`, `stat`, and
SHA-256 produced the PNG values above. After stopping the fixture, the scoped
SQLite query returned `{"artifacts":0,"bundleRevisions":0,"stateRevisions":0,
"collaborators":0,"users":0,"sessions":0,"workspaces":0,"integrationAccounts":0}`.
`tools/dev/sandbox.sh down` removed the sandbox directory; `lsof` found no
listeners on 4097, 4098, or 4199.

## Triage — the window image was mis-composed, now composed in the test

The 1440×893 dashboard PNG above was wrong: it showed only the artifact plus a
black band and omitted the Planning badge, the Dashboard/artifact tabs, the `+`
button, and the whole viewer toolbar (title, provenance, Reload).

Root cause, `ArtifactSnapshotter.captureWindow`: it drew the WKWebView snapshot
at `y = windowImage.height - frame.height` — the window's **top** edge — instead
of the web view's own origin in window coordinates. It also read `webView.frame`,
which is relative to the platform view's immediate superview, not the window. The
viewer actually sits *below* 110 px of Flutter chrome, so the snapshot landed one
chrome-height too high and painted over every widget the screenshot existed to
prove. The black band was the leftover platform-view region: the compositor omits
a platform view from an own-window `CGWindowListCreateImage`, which is why a
composite was needed at all. `NSImage.lockFocus` made it worse — its backing
scale follows the deepest screen, so the output size was display-dependent.

Fix (test-only; no product behavior change):

- `integration_test/live_artifacts_av06_native_smoke_test.dart` composes the
  window itself with `dart:ui`: `RenderRepaintBoundary.toImage` of the pumped
  tree for the real themed chrome, the existing `capture` channel for the real
  WKWebView snapshot, and `Canvas.drawImageRect` into
  `tester.getRect(find.byType(WebViewWidget))` scaled by the view's device pixel
  ratio. Geometry now comes from the widget tree, so there is no AppKit
  coordinate conversion to get wrong and no `lockFocus` scale surprise. No new
  dependency, no TCC, no screen recording.
- `macos/Runner/ArtifactSnapshotter.swift` — `captureWindow` and its `finish`
  helper are deleted (43 lines). The channel is DEBUG-only and still exposes
  `capture`, the plain WKWebView snapshot, which both the composite and the
  separate security PNG use.

Regression guard: the fixture bundle's accent `#6855d8` must be **absent** above
the artifact rect and **present** below it, matched exactly. Verified the guard
bites — decoding the WK-only PNG shows 397 exact accent pixels inside the top
110 rows, which is precisely what the old top-paste put over the chrome, while
the fixed composite has 0 there and 5,065 below. A distinct-colour count on the
chrome band guards the other direction (a blank or flat band). The first
candidate assertion, "chrome band has >50 colours", was measured against the old
image and discarded: the page's own heading supplies 409 colours, so it would
have passed the bug.

### Checks

```sh
export SB="$TMPDIR/opencode/rhythm-av06-fix2"
RHYTHM_SANDBOX_DIR="$SB" RHYTHM_LIVE_E2E=1 \
  RHYTHM_PCO_LIVE_BASE_URL=http://127.0.0.1:4199 tools/dev/sandbox.sh up
node tools/dev/av06_native_fixture.mjs "$SB/rhythm.db" "$SB/av06.env" "$SB/av06-evidence.json" &
source "$SB/av06.env"
cd apps/desktop_flutter
RHYTHM_LIVE_E2E=1 flutter test integration_test/live_artifacts_av06_native_smoke_test.dart -d macos \
  --dart-define=AV06_API_URL=http://127.0.0.1:4098 --dart-define=AV06_TOKEN="$AV06_TOKEN" \
   --dart-define=AV06_WORKSPACE_ID="$AV06_WORKSPACE_ID" \
   --dart-define=AV06_EVIDENCE_PATH="<worktree>/docs/ai/runs/evidence/av06-dashboard-artifact.png" \
   --dart-define=AV06_SECURITY_EVIDENCE_PATH="<worktree>/docs/ai/runs/evidence/av06-native-artifact.png" \
   --dart-define=AV06_PCO_COUNTER_URL=http://127.0.0.1:4199/_av06/counters
```

- Native smoke: **pass** — `00:07 +1: All tests passed!` (exit 0), twice, across
  two independent sandboxes. A1–A10 and the PCO leg unchanged.
- `docs/ai/runs/evidence/av06-dashboard-artifact.png` — 1440×861, 86,273 bytes,
  `sha256 f0357d4d5c9434d3c7d4ea5a572d91c922dcddac12983a5c1130e96c9f04f61e`,
  **byte-identical across both runs**. Visually verified to contain the Planning
  badge, `Dashboard` tab, selected `Worship Calendar A…` tab with its close
  control, the `+` button, and the viewer toolbar's title, `Updated Aug 9, 2026
  by AV06 native · Bundle 1 · State 1` provenance and Reload icon, above a clean
  rendered Worship Calendar. Production `AppTheme.light()`; no DEBUG banner, no
  snackbar, no hostile fixture chrome, no raw IDs, paths, or credentials.
- Security PNG stays separate and WebKit-only:
  `av06-native-artifact.png`, 1440×751, 82,253 bytes,
  `sha256 82e8f338b003b83f3c5f0305d102aad7eb08d83458efa77454d4d5bd785a3d56`.
- Neither PNG nor the API/fixture logs contain the session or fake PCO token.
  Fixture evidence `{"requests":1,"correctBearer":true,"forbiddenPath":false}`;
  post-cleanup marker counts all zero.
- `dart format . --set-exit-if-changed` — 457 files, 0 changed.
  `flutter analyze --no-fatal-infos <smoke test>` — No issues found.
- `detect_changes(scope: all)` — 2 changed indexed symbols, 0 affected
  processes, risk low. No release build re-run: the deleted Swift lives entirely
  inside `#if DEBUG`, so Release cannot regress from removing it, and the Debug
  app compiled and ran twice.
- Both sandboxes torn down; `:4097/:4098/:4099/:4199` free. The desktop engine on
  `:4096` kept PID 33193 from before the first build to after the last teardown.
