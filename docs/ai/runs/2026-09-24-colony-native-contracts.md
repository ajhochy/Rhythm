---
date: 2026-09-24
repo: rhythm
branch: codex/colony-native-receiver
pr: null
issues: [1527, 1528]
status: paused-unverified
tags: [run, rhythm]
---

## Files

Uncommitted/unpushed candidate in `/private/tmp/rhythm-colony-native-receiver` (base `60c30bf9`):

- Existing resolver adds required verified worker role and workerPath; existing resolver fixtures add sealed worker data.
- New `apps/electron/src/colony-service.mjs`: explicit runtime resolution, sanitized owned process, version/SQLite/capability handshake, source path admission, bounded coalescing/retry/shutdown, sticky disposal failure.
- New `colony-channel.mjs`: complete closed protocol request/response validation before native forwarding.
- New `colony-view.mjs`: fixed verified local asset handler, exact document/frame readiness receiver and native view lifecycle. This source has NOT passed actual native execution yet.
- Three native service/asset/frame contract suites plus two disposable fixture helpers; canonical plan, issue contracts and current-plan pointer.

No changes to main.mjs, outer preload.cjs, Shell/App/React UI, packaging or actual user stores. User-facing tab remains unimplemented in this candidate. User requested pause after open turns land; no subsequent slice started.

## Checks

- Original command over the three new suites: **17 RED / 0 pass** before implementation, `/private/tmp/colony-native-contracts-red.log`.
- Added old-Node/SQLite and unsafe-source regressions: **2 RED** before repair, `/private/tmp/colony-native-runtime-source-red.log`.
- `node --test apps/electron/test/colony-native-service-contract.test.mjs apps/electron/test/colony-native-assets-contract.test.mjs`: **14/14 pass**, `/private/tmp/colony-native-focused-final.log`.
- `node --test apps/electron/test/colony-desktop-artifact.test.mjs`: **37/37 pass**, `/private/tmp/colony-native-resolver-final.log`.
- `npm run typecheck --prefix apps/electron`: **exit 0**, `/private/tmp/colony-native-typecheck-final.log`.
- `git diff --check` and native fixture syntax check: exit 0.
- GitNexus impact resolveColonyArtifact/makeArtifact: target absent, risk UNKNOWN, index 204 commits stale. `/private/tmp/colony-native-impact-resolver.log`, `colony-native-impact-fixture.log`. Not a low-risk classification. New functions have no pre-existing callers; native wiring is still absent.

Native command attempted:

```
COLONY_NATIVE_ARTIFACT=/private/tmp/bot-crossing-colony-artifact/build/rhythm-embedded COLONY_NATIVE_SOURCE_COMMIT=a30b4c924be4344d444f1826e1dec88fb138a4ad node --test apps/electron/test/colony-native-frame-contract.test.mjs
```

**No native PASS.** Initial attempt and one bounded diagnostic attempt timed out after 25 seconds; each produced five hook failures. Diagnostic stderr stopped at `colony-fixture:before-ready`, before app.whenReady, view creation or source scanning. Logs: `/private/tmp/colony-native-frames1.log`, `/private/tmp/colony-native-frames-diagnostic.log`. Candidate Electron process exit was confirmed before disposable fixture removal.

The fixture's top-level wait was moved into async run() so it no longer holds initial ESM evaluation. That correction is syntax-checked only, **not rerun**, respecting the final agreed pause budget. It is a hypothesis-backed fixture repair, not proven resolution or product verification. The native fixture still requires execution after resume. No broad Electron suite or package build was run.

## Remaining acceptance and resume boundary

1. Rerun the existing isolated native command after review; assess real frame/preload/protocol behavior rather than assuming the fixture repair proves it.
2. Review native lifecycle/security source (actual ready timing, navigation/disposal and response refusal) and add any needed focused regression before repairs. Sticky child ownership failures must block replacement.
3. Main and outer preload integration plus actual Bot Crossing React tab/opt-in/error/bounds/capability behavior need separate contracts and implementation. They were deliberately not started after the pause request.
4. Native large-state/inventory/hostile-message matrix, actual packaged Node/SQLite and architecture receipts, full related gate and final clean artifact pin/rebuild remain outstanding.

Upstream worker runtime metadata was separately accepted/committed by parent as `a30b4c924be4344d444f1826e1dec88fb138a4ad`; the receiver candidate uses that exact clean fixture pin. No issue-wide completion, UI readiness or release claim.

## 2026-09-24 receiver completion follow-up

The orchestrator's first outside-sandbox native run reached the real pinned Electron fixture. `asset-and-private-state`, `sandbox-and-network`, and `foreign-actual-frame` passed; `navigation-revokes-document` and `sibling-and-stale-actual-frame` failed. Receipt: `/Users/ajhochhalter/Documents/rhythm-orchestration-evidence/2026-09-24-resume5/jobs/colony-receiver/native-run1.log`.

### Diagnosis and repairs

- `navigation-revokes-document` was a fixture-oracle defect. Chromium may retain the same `WebFrameMain` wrapper across a same-origin reload, so wrapper identity/detachment did not prove that document authority survived. The equal-or-stricter oracle now reloads the actual scene and requires the new preload's real `window.colonyEmbedded.request` to reject with `colony:revoked`; it then requires the owned view to be removed. This exercises absence of a replacement port rather than an implementation detail of Chromium frame wrappers.
- `sibling-and-stale-actual-frame` was a fixture timing defect. The same-URL sibling correctly received zero ports, but the legitimate main-frame positive control sampled after a fixed 100 ms under heavy host load. The positive control now waits for actual port arrival, bounded at five seconds; after it succeeds, the sibling must still have zero ports. Reload revocation waits on the receiver's `service.stop()` event, requires exactly one stop, requires the reloaded document to receive zero ports, and still requires zero forwarded native requests.
- Lifecycle review found two receiver defects independent of those native failures. A synchronous port-close event could re-enter `bindColonySceneChannel.dispose()` before its disposal promise existed, calling `service.stop()` twice. Also, a sticky owned-child exit-confirmation failure aborted `disposeCurrent()` before listener cleanup, storage clearing and protocol unhandle. Disposal is now reentrancy-safe, local view/partition cleanup is best-effort-complete before the first failure is rethrown, replacement attach returns the sticky failure without launching, and top-level dispose always unregisters handlers.

### RED and local GREEN evidence

- RED: `node --test apps/electron/test/colony-native-view-contract.test.mjs` — **0 passed / 3 failed**. The doubles reproduced duplicate stop under synchronous port close and incomplete local teardown after sticky child-exit failure.
- GREEN: `node --test apps/electron/test/colony-native-view-contract.test.mjs` — **3/3 passed** after repair. Coverage includes readiness queued once before load, second-readiness refusal, navigation revocation with a preserved frame wrapper, dispose idempotence, serialized/coalesced attach and full local teardown despite sticky child failure.
- Added service regression: outstanding `request()` waiters reject on explicit stop and owned-child crash.
- A combined run exposed the synthetic service fixture's 150 ms process-start deadline as too short under parallel load. The shared fixture allowance is now one second; the dedicated silent-worker deadline test still explicitly uses 150 ms.
- `npm run typecheck --prefix apps/electron` — **exit 0**.
- `node --check apps/electron/test/support/colony-native-electron-fixture.mjs` — **exit 0**.
- `node --test apps/electron/test/colony-native-view-contract.test.mjs apps/electron/test/colony-native-service-contract.test.mjs apps/electron/test/colony-native-assets-contract.test.mjs apps/electron/test/colony-desktop-artifact.test.mjs` — **55/55 passed** including nested resolver cases.
- `git diff --check` — **exit 0**.

GitNexus tools were not exposed in this implementer session. A direct caller search found `registerColonyView` used only by the native fixture in this bounded slice and `bindColonySceneChannel` used by `registerColonyView`, the native hostile-frame fixture and the new Node regression suite. No GitNexus risk classification is claimed.

### Pending native proof

The repaired five-case Electron fixture was not run here because Electron cannot launch in the assigned sandbox. The native result remains pending, not green. The orchestrator must rerun:

```
COLONY_NATIVE_ARTIFACT=/private/tmp/bot-crossing-colony-artifact/build/rhythm-embedded COLONY_NATIVE_SOURCE_COMMIT=a30b4c924be4344d444f1826e1dec88fb138a4ad node --test apps/electron/test/colony-native-frame-contract.test.mjs
```

Expected receipt: all five cases pass; navigation takes roughly the upstream preload's ten-second no-port deadline, the legitimate hostile-fixture main frame receives exactly one port within five seconds, the sibling and reloaded document receive zero, `service.stop()` runs once, and zero hostile native requests are forwarded. Packaged/installed/host UI and physical-device acceptance remain separate and unproven.

## 2026-09-24 late-bound receiver follow-up

The orchestrator's next real Electron 40.10.2 run passed four cases, including the repaired navigation oracle. `sibling-and-stale-actual-frame` still failed because its deliberately late-bound hostile receiver captured `committed = false` while `isLoadingMainFrame()` was transiently true after `loadURL()` had resolved; no later `did-finish-load` event existed to flush the accepted main-frame readiness.

The receiver now re-evaluates commitment inside `flush()` only when all current facts agree: the WebContents URL is the fixed entry URL, the current main frame URL is the same fixed entry URL, and the main frame is not loading. Exact sender/current/expected frame checks remain immediately before transfer. A main-frame cross-document navigation before commitment clears queued readiness for a deferred production frame, while a receiver bound to an explicit already-current frame disposes on navigation. This prevents an old/provisional queued event from gaining authority after a later commit.

RED: `node --test apps/electron/test/colony-native-view-contract.test.mjs` — **3 passed / 1 failed**; the sibling received zero ports but the late-bound exact main frame received zero instead of one.

Focused GREEN after repair: the same command — **5/5 passed**. The new tests assert same-URL sibling readiness transfers no port, exact main-frame readiness transfers exactly one port without a synthetic `did-finish-load`, and readiness queued by an older document cannot cross a pre-commit navigation. The native fixture also records non-Error rejections with `String(error?.message ?? error)` so receipts cannot silently omit failure text.

The real five-case Electron rerun remains pending outside this sandbox.
