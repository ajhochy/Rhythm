---
date: 2026-09-11
repo: Rhythm
branch: feature/electron-flutter-retirement
pr: null
issues: [E12B]
status: PASS
tags: [run, Rhythm]
---

## Files

Exclusive E12B scope: main signer, minimal native Swift/build helper, package/sign wiring, focused signer/package tests, E12B contract and this run. E50/E51 changes present at entry are not owned or edited. HEAD at entry: `72dd9bb7`.

Exact owned files:
- `apps/electron/src/human-approval-main-signer.mjs`
- `apps/electron/native/HumanApprovalSigner.swift` (new)
- `apps/electron/scripts/build-approval-helper.mjs` (new)
- `apps/electron/scripts/package-mac.mjs`
- `apps/electron/scripts/sign-and-notarize-mac.mjs`
- `apps/electron/test/electron-e12b-native-signing.test.mjs` (new)
- `apps/electron/test/human-approval-main-signer.test.mjs` (canonical entry imports safe E12B tests; legacy raw-Node Keychain tests retired)
- `apps/electron/test/human-approval-isolated-home.test.mjs`
- `docs/ai/contracts/electron-e12b-native-signing.json` (new)
- `docs/ai/runs/2026-09-11-electron-e12b-native-signing.md` (new)

## Checks

### Phase 0 complete — acceptance RED

- Loaded acceptance-contract first; read AGENTS.md, project-state and current-plan without changing them. Explicit dispatch supplies acceptance and bounded verification; no orchestrator skill is available in this session.
- `node --experimental-vm-modules --test apps/electron/test/electron-e12b-native-signing.test.mjs`: 0 pass / 8 fail. Initial harness produced five import errors because legacy signer still imports execFile; corrected the harness to assert the absent native boundary before linking (never invokes legacy CLI).
- `node --experimental-vm-modules --test --test-reporter=dot apps/electron/test/electron-e12b-native-signing.test.mjs`: eight assertion failures. Examples: `native stdin boundary must replace the legacy CLI before exercising it`; `native Security.framework source must exist`; missing `await buildAndStageApprovalHelper(...)`. Exportable-key assertion fails on existing PEM/CLI implementation.
- Contract: eight automated criterion groups; two explicit manual hardware/artifact criteria. No real Keychain call occurred.

### Phase 1 complete — impact

- Worktree not independently indexed; empty UID lookup initially failed. Explicit canonical Rhythm UIDs resolve.
- `impact(signDecision, upstream)`: LOW, 2 direct (main + signer test), 0 processes.
- `impact(File:apps/electron/src/human-approval-main-signer.mjs, upstream)`: LOW, 4 direct imports (main, agent-server, signer tests), 2 indirect, 0 processes.
- Both package/sign script file impacts: LOW, 0 direct / 0 processes. Existing packaging functions remain unchanged; additive top-level wiring only.

### Phase 2 complete — implementation and focused GREEN

- Replaced exportable Node key/CLI storage with bounded EOF JSON pipes to the packaged native executable: 4 KiB request, 8 KiB response, 10-second deadline, immediate stderr rejection, fixed/redacted errors, no inherited secret/DYLD environment, no argv input. Node validates exact response shape, canonical encodings, actual P-256 point, and DER signature against exact decision bytes.
- Swift creates only a permanent Secure Enclave P-256 key with device-only unlocked privateKeyUsage access control; no software fallback. Public-only export; fixed canonical SHA-256 digest signing; capability stays in the existing generic-password identity through Security.framework (not CLI). Native source validates closed operations/decision schema before key access.
- First GREEN: `node --experimental-vm-modules --test apps/electron/test/electron-e12b-native-signing.test.mjs apps/electron/test/human-approval-isolated-home.test.mjs apps/electron/test/human-approval-main-signer.test.mjs` → 9 passed, 3 legacy live tests skipped. `npm run typecheck` in apps/electron found TS2339 on caught error `.code`; repaired with an Error/property guard. No dependency repair.
- Security review found direct helper launch would bypass E12A. Added RED static assertion first: `node --experimental-vm-modules --test --test-name-pattern=e12b-c7 apps/electron/test/electron-e12b-native-signing.test.mjs` → 1 assertion failure, `a raw shell must not bypass E12A by launching the signer`. Added Security.framework dynamic parent identity check: Apple-anchored `com.rhythm.desktop`, same signing team as helper, stable PID. A shell, unsigned development Electron, and ad-hoc builds deliberately return unavailable. This is within the owned helper, with no main/preload change.
- First-use race RED: `node --experimental-vm-modules --test --test-name-pattern='concurrent first-use' apps/electron/test/electron-e12b-native-signing.test.mjs` → 1 assertion failure, `2 !== 1`, only one helper may own key creation. Added a main-process promise queue, consistent with existing single-instance app ownership. Rejected operations release the queue.
- Final maintained contract command (repo root): `node --experimental-vm-modules --test apps/electron/test/human-approval-main-signer.test.mjs apps/electron/test/human-approval-isolated-home.test.mjs && npm --prefix apps/electron run typecheck && RHYTHM_LIVE_E2E=0 /opt/homebrew/opt/node@22/bin/node apps/api_server/node_modules/vitest/vitest.mjs run --root apps/api_server src/__tests__/human_approval_signature.test.ts` → **10 Node tests passed, 0 failed/skipped; Electron typecheck exit 0; existing API signature tests 4 passed, 0 failed**, combined exit 0. The API test uses its maintained in-memory DB/ephemeral HTTP harness, not server.ts, the engine, or the shared sandbox. No API file changed.
- Source syntax (apps/electron): `node --check src/human-approval-main-signer.mjs && node --check scripts/build-approval-helper.mjs && node --check scripts/package-mac.mjs && node --check scripts/sign-and-notarize-mac.mjs` → exit 0. Swift checks are source assertions only, not compiler/typechecker evidence.
- `git diff --check` → exit 0. `detect_changes(scope=all, worktree=/Users/ajhochhalter/Documents/Rhythm-electron-flutter-retirement, repo=Rhythm)` → LOW, 33 mapped symbols, 9 tracked files, 0 affected execution flows. This shared worktree result includes concurrent web files; untracked Swift/build/test additions are outside the existing index and reviewed directly. No HIGH/CRITICAL result.

### Handoff

READY_FOR_VERIFICATION for the requested proportional tier, **not release/hardware qualified**. Nine automated criteria covered by focused tests/static assertions; two manual criteria remain UNVERIFIED. Native parent authorization and persistence must be checked from a properly signed packaged Rhythm app in a dedicated account. The old `test:keychain` raw-Node path is not native behavioral proof; its test entry now runs the safe contract suite with the canonical `--experimental-vm-modules` command above.

## Notes

### Verification repair — Phase 0 and Phase 1 complete

- Exact request: disable Electron alternate Node loaders/debug paths using installed official @electron/fuses 2.1.3 before either signing entry point; serialize native key lookup/creation across processes. Existing unpacked E10 packaging retained.
- Read worktree AGENTS.md, project-state.md and current-plan.md. Branch verified `feature/electron-flutter-retirement`; existing E12B and concurrent E50/E51 edits preserved. workflow-orchestrator is not available; explicit manager dispatch supplies scope/gates.
- RED command: `node --experimental-vm-modules --test --test-name-pattern='e12b-c12|e12b-c13' apps/electron/test/electron-e12b-native-signing.test.mjs` → **0 pass, 2 assertion failures**: `fuse hardening is mandatory, not an optional packaging flag`; missing `let lock = try acquireKeyCreationLock()` before query.
- GitNexus upstream file impact: package-mac and sign-and-notarize both LOW / 0 direct / 0 processes. Swift signingKey lookup UNKNOWN/unindexed; inspected its sole caller respond and full query/create/requery path directly. Main JS signer unchanged in this repair. No HIGH/CRITICAL result.
- Native lock remains static-only under explicit no Swift compilation/execution restriction; no replacement-language mock is claimed as Darwin flock evidence.

### Verification repair — Phase 2 complete / READY_FOR_VERIFICATION

- Changed exactly seven files in this repair: `apps/electron/scripts/harden-electron-fuses.mjs` (new), `apps/electron/scripts/package-mac.mjs`, `apps/electron/scripts/sign-and-notarize-mac.mjs`, `apps/electron/native/HumanApprovalSigner.swift`, `apps/electron/test/electron-e12b-native-signing.test.mjs`, `docs/ai/contracts/electron-e12b-native-signing.json`, and this run note. Manager-installed package.json/package-lock fuses dependency retained unchanged; no other dependency changes.
- Both packaging/sign entry points await shared official `flipFuses` policy against final renamed `Contents/MacOS/Rhythm` before helper/outer signing. Official library resolves macOS framework fuse storage; no custom wire mutation. Pre-read rejects missing/removed/unsupported required fuses; post-read requires disabled values; errors propagate. RunAsNode, NODE_OPTIONS and CLI inspect disabled; ASAR-only and embedded-integrity disabled to preserve unpacked app. No automatic signature reset before our signing phase.
- Swift uses account-database home (not env), fixed `Library/Application Support/com.rhythm.desktop.approval-signer/key-creation.lock`, private directory and 0600 regular single-link owner-checked file, no-follow/close-on-exec directory-relative open. Nonblocking exclusive flock retries at 20ms for at most a five-second deadline; errors/timeouts fail closed. Lookup/create/requery all hold the same lock, with deferred unlock/close on every exit. Nonsecret inode is retained; no secret writes or deletion.
- GREEN command: `node --experimental-vm-modules --test apps/electron/test/human-approval-main-signer.test.mjs apps/electron/test/human-approval-isolated-home.test.mjs apps/electron/test/electron-e10-engine-package.test.mjs && npm --prefix apps/electron run typecheck` → **22 tests pass (12 E12B/isolated-home + 10 E10 including subtests), 0 fail/skip; typecheck exit 0**. Passed first implementation attempt. E10 uses its existing controlled-input temporary assembly test, not real package/fork build.
- API command: `RHYTHM_LIVE_E2E=0 /opt/homebrew/opt/node@22/bin/node apps/api_server/node_modules/vitest/vitest.mjs run --root apps/api_server src/__tests__/human_approval_signature.test.ts` → **4 tests pass, 1 file pass**, exit 0. No API source modified, no shared sandbox use.
- `git diff --check` → exit 0. `git diff --stat`, owned package/sign/package.json diff, and `git status --short` reviewed. `detect_changes(scope=all, worktree=/Users/ajhochhalter/Documents/Rhythm-electron-flutter-retirement, repo=Rhythm)` → **LOW, 35 mapped symbols, 11 tracked files, 0 affected flows**; includes prior signer and concurrent web edits, not changes made by this repair. Untracked Swift/new policy/tests inspected directly; index does not prove their runtime behavior.
- Handoff: READY_FOR_VERIFICATION at the explicitly requested proportional tier. Both new criteria pass source-policy checks; **not hardware/release qualification**. No real app/fuse mutation, Swift compile, helper execution, Keychain, signing, network, full suite, normal Electron, sandbox management, commit/push/PR/issues/peer actions.

No commit/push/PR/issues/peer dispatch; no sandbox control, real helper/Keychain, compilation, signing, packaging, normal Electron or full suites. Manager owns wave3.

### Migration / rollback

The new key uses application tag `com.rhythm.desktop.human-approval.secure-enclave.v2`, not the legacy generic-password service `rhythm-electron-human-approval-key` / account `signing-key-v1`. The old entry is neither read nor deleted. A non-exportable identity cannot import that old software key: **public-key re-registration is required**. Existing agent-server startup obtains the new raw P-256 public key and capability digest through unchanged capabilityMaterial; independently registered consumers must replace the old public key before approving. Restart the local API to register the new material. Existing capability service/account remain stable.

Later migration/rollback is a separately approved operation: verify new signing/registration in a dedicated account first; retain the old entry during the rollback window. Rolling back to old app code restores the old signing identity and requires registering its old public key again. It also restores the old exportable-key security limitation; never silently fall back in E12B. No destructive cleanup or automated downgrade is included.

### Manual verification targets (not_tested)

- e12b-c9: Dedicated macOS test account only, launched through signed packaged Rhythm: real Security.framework key creation, token/access-control attributes and private export rejection; same public key/capability after restart; native DER signature through unchanged API verifier for approved/rejected/null digest and tamper rejection; locked/unsupported hardware unavailable; existing legacy entry retained; re-register/rollback test. Direct shell, unsigned/ad-hoc Electron and wrong-team/identifier parents must fail without key access. Never use AJ's account.
- e12b-c10: Native arm64 and x64 runners: compile from source, inspect exact architecture, package, Developer ID sign (stable helper identity), verify nested helper and outer signature; actual hardware capability result, including Intel without Secure Enclave. Static wiring is not artifact proof.
- e12b-c9 repair targets: dedicated-account signed-parent rejection using ELECTRON_RUN_AS_NODE, NODE_OPTIONS and CLI inspect attempts; simultaneous independent helper processes on first use must return the same persisted key, blocked lock must time out without key creation, lock must release after success/error/process termination. No such native runtime test was run here.
- e12b-c10 repair targets: inspect required fuse values in both signed architecture artifacts and verify ordinary unpacked-app launch still works; missing/unsupported fuse must stop packaging/signing before helper/outer signatures.
