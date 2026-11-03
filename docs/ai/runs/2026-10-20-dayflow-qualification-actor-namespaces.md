---
date: 2026-10-20
repo: Rhythm
branch: test/feature-playwright-2026-10-19
pr: null
issues: []
status: in_progress
tags: [run, rhythm]
---

# Dayflow qualification actor namespace isolation

## Files

- `apps/electron/src/main.mjs` passes the already validated synthetic qualification actor into the native Dayflow host.
- `apps/electron/src/native-dayflow-production-host.mjs` binds actor-specific preferences and keychain namespaces to the actor's validated fixture root, owner user ID, and token. The actor data root must be exactly `<fixtureRoot>/native-dayflow`; malformed or mismatched actor scope throws before native module loading. Native login-item events in this actor path report a disabled synthetic state without reading or changing the operator's OS setting. Ordinary launches retain the sidecar's defaults and real login-item handling.
- `apps/electron/test/native-dayflow-production-host.test.mjs` checks the actor and ordinary handoffs, uniqueness/stability, rejection of a mismatched data root, an optional handoff through the real recovered builder sidecar, and native login-item event isolation.

## Checks

- GitNexus upstream impact before edits: `registerNativeDayflowProductionHost` LOW, zero indexed callers/processes; `qualificationSyntheticActor` UNKNOWN/unindexed. The index was 270 commits stale. Manual caller inspection found the single registration in `main.mjs` and the sidecar's `createInstallConfiguration` handoff.
- Guarded RED: `npm run build:guard -- /bin/zsh -f -c 'cd apps/electron && node --test --test-name-pattern="qualified actor installs" test/native-dayflow-production-host.test.mjs'` exited 1 because the actor install's `preferencesSuite` was `undefined`. Complete output: `/private/tmp/rhythm-dayflow-actor-red-20261020.log`.
- A second guarded RED showed a token object with a `toString()` that looked like a token passed the host's regex; `/private/tmp/rhythm-dayflow-actor-malformed-red-20261020.log`. The host now requires the token's actual type to be `string`, matching the validated loader output.
- Guarded login-item RED: a qualified actor attach followed by native `launchAtLoginEnable`/`launchAtLoginDisable` caused a real login-item `get`, `set(true)`, `get`, `set(false)`, `get` sequence. Complete output: `/private/tmp/rhythm-dayflow-actor-login-red-20261020.log`. GitNexus upstream impact for `setLoginItem` was LOW, zero indexed callers/processes, with the stale-index limitation.
- Guarded GREEN with `RHYTHM_DAYFLOW_SIDECAR_PATH=/private/tmp/rhythm-dayflow-recovered-inputs-20261020/new-source-input/Production/native-dayflow-embedded-host.cjs`: the 31-test native host file passed, including the actual sidecar configuration handoff and actor native event test proving zero real login-item reads/writes, while an ordinary launch still reads/writes the OS adapter. Complete output: `/private/tmp/rhythm-dayflow-actor-green-20261020.log`. No addon, service, OS permission, or capture was started by these tests.
- `node --check` on the two source files and test passed; `git diff --check` passed. GitNexus `detect-changes --scope unstaged` reported LOW risk, zero indexed processes, with the same stale-index limitation and unrelated concurrent edits visible.
- Electron typecheck failed on existing broader `qualification-*` and `main.mjs` diagnostics, with no diagnostic in `native-dayflow-production-host.mjs`; full output: `/private/tmp/rhythm-dayflow-actor-typecheck-tests-20261020.log`. A broader two-file test run passed all 30 native host tests but failed seven `dayflow-host-hooks` tests on `Unexpected main import: ./qualification-model-loan.mjs` in their VM harness. Full output: `/private/tmp/rhythm-dayflow-actor-related-tests-20261020.log`. The latter import is a concurrent change outside this Dayflow repair.

## Notes

The recovered Swift service source initializes recording false before constructing `ScreenRecorder`; a fresh suite has `didOnboard == false` and raw onboarding step 0. Every migration maps 0 to 0, which has not passed screen-recording onboarding, so the early-onboarding branch retains recording false and does not call `restoreRecordingPreference` or `SCShareableContent`. This is a source-level safety finding, not native runtime proof. No Dayflow app or packaged native payload was launched. The prior tracked wrapper build receipt predates this source change and must be rebuilt at a new frozen HEAD before any package layout is composed.
