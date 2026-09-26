# Connected iPhone and remaining verification repairs

User request: use Xcode to launch the mobile app on the connected phone, run the checks, and resolve the remaining failures. Continue on the existing mega branch; preserve working login/accounts, the open desktop candidate and user data. No main merge or production deployment.

## Work and ownership

- Root: build/install/launch the actual current mobile source on the paired iPhone using Xcode; exercise device UI, inspect logs and collect native evidence. Review, combine, verify and commit repairs.
- Terra mobile: reproduce and repair the three missing Open workspace menu cases. Scope apps/mobile JS/TS and browser test harness; do not mutate ios project/build/signing while root builds.
- Terra engine: reproduce interrupted bash output cancellation failure; diagnose before edits, preserve truncation assertions, run the affected session suite. The user's explicit request authorizes repairing this known vendored engine failure.
- Terra Hermes: diagnose the borrowed backend probe renderer-load hang using a sample of its exact disposable Electron process. Repair the lowest failing boundary; never signal or modify the user's open candidate or personal runtime.

## Existing failing acceptance contracts

- Mobile: tests/e2e/flows.spec.mjs workspace conflict-checked VCS save and worktrees/MCP creation; issue-1174-parity.spec.mjs adapter search/VCS/project metadata. All must find the real visible menu and complete their behavior without weaker assertions.
- Engine: test/session/prompt.test.ts, cancel finalizes interrupted bash tool output through normal truncation. Must complete and preserve truncated output metadata and saved output behavior.
- Hermes: apps/electron/test/hermes-desktop-ownership-live.test.mjs, issue-1542-desktop-c5. Actual preload must return the owner-published endpoint; disposing the embed must leave that authenticated backend alive. The existing 102.5-second renderer-load failure is the starting evidence, not a pass.
- Phone: current branch provenance, signed physical-device build/install/launch, visible screens and reachable configured service, lifecycle/audio checks where controllable. Synthetic test data only for writes. Never infer physical sound or off-LAN operation from web/simulator tests.

## Checklist

- [x] Confirm paired iPhone over USB with Developer Mode enabled.
- [x] Inspect current mobile signing/project/build. Existing signed development client loads current mega JavaScript; fresh native compilation remains blocked in Xcode's own compiler probes.
- [x] Repair the mobile workspace menu, engine test readiness and isolated Hermes borrowed-backend contracts; preserve their assertions.
- [ ] Run physical-device checks and inspect launch/runtime failures.
- [ ] Inspect existing hosted/write/relay/package gates and complete those supported by available access.
- [ ] Review diffs, rerun appropriate full suites and current native behavior.
- [ ] Record results, update existing draft PRs and commit/push reviewed repairs.

Every source edit requires GitNexus impact beforehand. Agents do not commit, push, deploy or manipulate root's app/device session. Root records exact results and separates failed tests from untested external gates.

## Physical and hosted findings during execution

- User specifically requested iPhone Mirroring as the UI driver. Root used that app for launch, navigation, cloud Email reads, overflow opening and sound-preference relaunch checks. No simulator result substitutes for those observations.
- Integration mobile dependencies were a symlink outside Metro's project root, producing an invalid native bundle path. Replaced only the integration symlink with an isolated APFS clone of matching dependencies; native bundle now loads. Root checkout dependencies unchanged.
- Xcode 26.5 stalls before compilation in `clang -v -E -dM` probes whose output pipes are not drained by SwiftBuild. Fresh DerivedData and a single `-jobs 1 -quiet` build reproduce it. Cancelled only the owned build trees. No fresh native package or TestFlight result claimed.
- Phone initially reports incompatible protocols because the hosted relay is offline and returns old Mac health. Current local API/phone fingerprints match. Electron startup omitted the existing authenticated relay session; restoring that at owned-child startup is built, signed and observed online. Keep credentials bound to their configured API destination; do not restart live jobs on auth changes.
- Actual Tools title overlapped the iPhone status clock. Safe-area repair is visibly confirmed on the phone. Chats overflow opens; full mobile browser suite passed 71 with one expected skip. Working sound was initially on, was temporarily disabled for testing, and remained off through app termination/relaunch. Root clicked its initial on value back before refreshing; final visual read-back was interrupted by Mirroring reconnect/capture failures. Audible output remains separately unverified.
- Hosted native tests exposed test transport/geometry problems. A screenshot taken while CDP changed routes appeared to retain Hermes, but the user challenged that attribution and root verified normal native tab clicks hide Hermes correctly. Remove the speculative visibility edit; diagnose the test's navigation/action path without claiming a product visibility regression.
- Engine session suite: 396 passed, 5 skipped, 1 todo; cancellation now waits for actual shell output before cancelling. C5 borrowed-backend proof: root rerun 1/1, after a test-only mock Keychain switch prevents a native authorization-sheet deadlock.
- Hosted campaign marker audit: six authenticated collections contain zero campaign markers before testing and after r2 cleanup. This is scoped collection evidence, not database-global absence.

## Close-out checkpoint

Current result: [device/relay run](../runs/2026-09-19-connected-phone-relay.md). Phone connection/reply/background-reopen and exact synthetic-chat deletion observed. Live relay correlation1/1; current signed Desktop read checks2/2. Last hosted focused run Automationspass, Facilitiesfail. Final repository PR gate passed all 16 stages, zero failures. At AJ’s request, filed Facilities UI follow-up1545. After AJ asked how many more tests, root committed to finishing only the focused hosted rerun and already-running repository gate; no additional test cycle is started. External gates remain explicitly open.
