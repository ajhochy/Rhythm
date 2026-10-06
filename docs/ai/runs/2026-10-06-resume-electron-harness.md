---
date: 2026-10-06
repo: Rhythm
branch: integration/2026-10-06-resume
pr: 1604
issues: []
status: unverified
tags: [run, rhythm]
---

# Electron VM harness repair

## Files

- `apps/electron/test/{electron-shell,main-runtime,e12a-auth-boundary,hermes-accounts-wiring-contract,hermes-agent-bridge,hermes-desktop-install-ipc,hermes-server,issue-1579-contract,dayflow-host-hooks}.test.mjs`: provide the actual main module file URL to VM import metadata. Preserve fixture dirname and existing policies. BrowserWindow stubs lacking EventEmitter behavior now inherit it; the new native host binds window lifecycle events.
- `apps/electron/test/electron-shell.test.mjs`: await the fixture's actual `loadURL` readiness signal with a cleared two-second failure bound. One `setImmediate` did not establish readiness after asynchronous auth restoration under full-suite load.
- `apps/electron/test/dayflow-host-hooks.test.mjs`: admit actual inert native-host registration and standard `node:module`/`node:path.join` imports into the strict linker. Native wrapper/addon loading remains unexercised by these host-hook tests.
- `apps/electron/test/post-m1-phase-7-native-notifications.test.mjs`: signing-property source guard now anchors to object boundaries. The former `sign\s*:` matched the tail of the approved `'open-design:status'` channel. Positive mutation cases still reject arbitrary signing and notification primitives.
- `apps/electron/test/security-smoke-receipt.test.mjs`: exact native Dayflow six-method contract, actual preload receipt, fixture/collector coverage, missing/unfrozen/extra/reordered negative cases. Real preload mutation still fails closed.
- Orchestrator owns product changes in `security-smoke-receipt.mjs`, the main receipt collector, and `package.json` test membership. Release agent owns type-only main/native-host annotations. This lane did not edit those files.

## Checks

Commands run from this integration worktree; test commands use `apps/electron`.

- Baseline provided by orchestrator: `npm test` at `9de19872`: 524 tests, 420 passed, 100 failed, 4 skipped. `/private/tmp/rhythm-resume-electron-unit.log`.
- RED reproduce: `node --experimental-vm-modules --test --test-concurrency=1 test/main-runtime.test.mjs`: 0/4, `ERR_INVALID_ARG_VALUE`, `createRequire(import.meta.url)` receives undefined because VM fixtures set dirname only. `/private/tmp/rhythm-resume-electron-harness-red.log`.
- Focused isolate after metadata: remaining first-runtime failure was synthetic Window lacking `.on`, preventing real window-ready publication. The Dayflow hook linker additionally lacked new standard/module imports. Corrections preserve every behavioral assertion.
- PASS: `node --experimental-vm-modules --test --test-concurrency=1 test/main-runtime.test.mjs test/dayflow-host-hooks.test.mjs test/native-dayflow-production-host.test.mjs test/e12a-auth-boundary.test.mjs test/hermes-accounts-wiring-contract.test.mjs test/hermes-agent-bridge.test.mjs test/hermes-desktop-install-ipc.test.mjs test/hermes-server.test.mjs test/issue-1579-contract.test.mjs`: 162/162, zero failures. `/private/tmp/rhythm-resume-electron-harness-focused-all.log`.
- PASS: `node --test test/native-dayflow-production-host.test.mjs`: 28/28. `/private/tmp/rhythm-resume-native-host-current.log`.
- PASS: `node --experimental-vm-modules --test test/dayflow-host-hooks.test.mjs`: 7/7. `/private/tmp/rhythm-resume-dayflow-hooks-current.log`.
- Count correction: an intermediate report of native-host 31 was a combined pass count (native 28 + main-runtime 3), not a native-only result. This checkout has seven host-hook tests; a historical claim of fourteen is unsupported by these exact commands. No tests were removed to produce these counts.
- PASS: `node --experimental-vm-modules --test --test-concurrency=1 test/security-smoke-receipt.test.mjs test/post-m1-phase-7-native-notifications.test.mjs`: 12/12. `/private/tmp/rhythm-resume-electron-security-focused.log`.
- First repaired full `npm test`: 560 total, 552 passed, 4 failed, 4 existing gated skips. All four failures were undefined-window errors in external link/save-file/restart tests, before their ownership assertions. The shared synthetic `interactiveRuntime` returned after one tick; auth restoration I/O had not settled. This is fixture readiness, not a failed product policy assertion.
- PASS: `node --experimental-vm-modules --test --test-concurrency=1 test/electron-shell.test.mjs` after explicit fixture load readiness: 23/23. `/private/tmp/rhythm-resume-electron-shell-focused.log`.
- Pending final repeat: exact `npm test` full checkpoint, including newly added native-host and Dayflow hook files. Output `/private/tmp/rhythm-resume-electron-unit-repaired.log`.
- PASS: `git diff --check`.

## Notes

- Source context: dispatch baseline `9de19872`; first read `99ed379f`; full checkpoint launched at `25705e3e511dee389256590b3f538982b1ba484b`, plus uncommitted owned harness/source repairs. Orchestrator must record final committed source SHA.
- GitNexus upstream impact on each edited named fixture helper, Window class, and `receiptFromRealPreload`: LOW, no indexed direct callers/processes. Source inspection confines callers to these test files. No HIGH/CRITICAL symbol edits in this lane.
- No policy assertions weakened, no new skips/exclusions, no normal-profile app launch, no production API/manual API startup, no phone installation, no commit/push/release.
- Full suite's existing uniquely owned isolated Electron smoke subprocesses are authorized by orchestrator; those are test fixtures, separate from normal-profile live acceptance. Any generated tracked shell screenshot is evidence noise for the orchestrator to restore before committing.
- Remaining acceptance: orchestrator independent diff review/verification-gate, signed packaged/native real hardware behavior. Unit tests do not establish these gates.
- Decisions: fix VM metadata and implement real Electron event behavior at the host seam; retain strict closed receipt capability enforcement and report source mismatch to its owner.
- Deviations: none within test ownership.
