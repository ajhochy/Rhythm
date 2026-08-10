---
date: 2026-08-09
repo: Rhythm
branch: feat/artifact-viewer
pr: null
issues: [AV-06]
status: READY_FOR_VERIFICATION
tags: [run, Rhythm, live-artifacts, harness]
---

# AV06 C3/C4 harness repair

## Files
- `apps/desktop_flutter/integration_test/live_artifacts_av06_native_smoke_test.dart`
- `apps/desktop_flutter/test/features/live_artifacts/av06_runtime_contract_test.dart`
- `docs/ai/contracts/live-artifacts-av06.json`

No product source changed.

## Acceptance contract
Before the fixture repair, the native smoke failed after real sandbox launch:

```text
Expected: an object with length of <4>
Actual: ... has length of <3>
only native form, download, and file capture may produce accepted feedback
```

The real bridge unit group covers only `host.blocked`: every one of the five
allowlisted nonce-bearing reasons returns `ok` and calls `onBlocked` once;
unknown, omitted-nonce, and non-string payloads distinguish `request_failed`
from `malformed_request`, invoke no callback, and make zero data-source calls.
It does not overclaim coverage for the other C3 bridge methods. No deterministic
clock seam exists, so no `_showBlocked` widget debounce test was added without a
prohibited product-code change.

## Native evidence
- Fixture no longer manufactures `host.blocked`; its download is the real in-DOM
  `a#download` data link. Link/media gestures remain native A2/A6 evidence.
- Accepted feedback: **4** (form ×2, download, file).
- Raw bridge delta: **6** (four accepted + `not-json` + unknown); unknown accepted: **0**.
- One visible debounced snackbar; blocked/malformed/unknown actions caused zero
  host/data-source/API delta and zero additional PCO requests.
- A1–A10, C3–C5, state revision 1→2, PCO fixture, and cleanup passed.
- Dashboard screenshot SHA-256:
  `f0357d4d5c9434d3c7d4ea5a572d91c922dcddac12983a5c1130e96c9f04f61e`.
- Native artifact screenshot SHA-256:
  `82e8f338b003b83f3c5f0305d102aad7eb08d83458efa77454d4d5bd785a3d56`.

## Checks
- `flutter test test/features/live_artifacts/av06_runtime_contract_test.dart` — pass, 10 tests.
- `tools/dev/sandbox.sh up` with `RHYTHM_PCO_LIVE_BASE_URL=http://127.0.0.1:4199`; fixture; `flutter build macos --debug`; native smoke with `AV06_PCO_COUNTER_URL` — pass, `00:07 +1: All tests passed!`; sandbox and fixture cleanup completed.
- `dart format . --set-exit-if-changed` — pass.
- `flutter analyze --no-fatal-infos` — pass.
- `flutter test test/features/live_artifacts` — pass.
- `flutter test` — pass, 1090 tests.
- `git diff --check` — pass.
