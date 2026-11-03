---
date: 2026-10-20
repo: Rhythm
branch: test/feature-playwright-2026-10-19
pr: null
issues: []
status: verified-scoped
tags: [run, Rhythm, electron, dayflow]
---

# Dayflow installed-app release compatibility

## Files

- `apps/electron/src/dayflow-desktop-artifact.mjs` — accepts the exact 2.7.2/build 136 tuple only under an explicit runtime option, while the default validator remains pinned to 2.6.0/build 133. Identity, Team ID, arm64, exact Developer ID requirement and Gatekeeper checks still run after version acceptance; metadata returns the verified tuple.
- `apps/electron/src/dayflow-desktop.mjs` — supplies that option only while validating the fixed installed candidate. Bundled validation and the no-fallback-on-invalid-installed rule remain unchanged.
- `apps/electron/test/dayflow-desktop-artifact.test.mjs` and `apps/electron/test/dayflow-desktop.test.mjs` — exact-tuple/negative/command-construction and host candidate option coverage.

## Checks

- Before source edits: `node --test --test-concurrency=1 --test-name-pattern='installed Dayflow 2.7.2|only the installed candidate' test/dayflow-desktop-artifact.test.mjs test/dayflow-desktop.test.mjs` failed both new tests. Validator rejected 2.7.2; host returned `ARTIFACT_INVALID` because it did not opt in.
- After source edits: `node --test --test-concurrency=1 test/dayflow-desktop-artifact.test.mjs test/dayflow-desktop.test.mjs` passed 12/12. `node --experimental-vm-modules --test --test-concurrency=1 test/dayflow-host-hooks.test.mjs` passed 7/7. `npm run typecheck`, syntax checks for both changed modules and `git diff --check` passed.
- Real macOS read-only validation with `promisify(execFile)` passed for `/Users/ajhochhalter/Applications/Dayflow.app` as 2.7.2/build 136 and `/Applications/Rhythm.app/Contents/Resources/dayflow-desktop/Dayflow.app` as 2.6.0/build 133. Both returned `teleportlabs.com.Dayflow`, Team ID `L75WYD8X4Y`, arm64 after `plutil`, `codesign`, `lipo`, exact designated requirement verification and `spctl` assessment. The real host's `getStatus()` with those candidates returned `ready`, version 2.7.2/build 136. No `open()` call was made.
- Parent must rebuild the exact local app and rerun packaged Dayflow signed-app readiness. The embedded native Dayflow module is still absent and remains a separate blocked qualification.

## Notes

- The default validator call sites in staging, package signing and packaged verification pass no runtime option, so only 2.6.0/build 133 remains eligible for packaging.
- GitNexus is stale in the original checkout and absent in this worktree. Disambiguated upstream impact on both edited functions returned LOW and zero indexed callers/processes/modules. Manual call-site review covered the main-owned host, staging, signer, packaged verifier and dedicated tests.
- No installed app, native module, permission, account setting, launcher, commit, push or PR was changed in this lane.


## Packaged signed-app readiness

The exact locally rebuilt/signed cf49 candidate passed `[AI Dayflow] original signed application artifact is ready` (770 ms) in the parent's focused packaged run. Actual main-process signature/version validation returned ready, and the real Agent Tools descriptor was visible. The test neither opened the recording app nor granted recording permissions. This confirms the installed 2.7.2/build 136 compatibility repair; the separate embedded native Dayflow module remains absent and unqualified. See [combined repair run](2026-10-20-mega-ai-repairs.md) for exact build/run command and private receipts.
