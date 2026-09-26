---
date: 2026-09-19
repo: Rhythm
branch: mega/2026-09-18-mobile-electron-hermes
pr: 1544
issues: []
status: local-smoke-passed
tags: [run, Rhythm]
---

## Files

- Electron now recognizes a healthy Rhythm API and engine on 4001/4096 and reuses them without ownership or shutdown signals. An occupied unhealthy or unrelated listener still prevents a second server launch.
- Native approval helper retains an existing v2 enclave key if readable; otherwise creates a CryptoKit Secure Enclave key and stores its device-bound encrypted representation as a new v3 login-Keychain entry. No raw private key leaves the enclave. Existing signing keys and capability entries are preserved.
- Updated focused regression tests and replaced the inaccurate instruction to unlock an already-unlocked Mac.
- Earlier requested OAuth revert remains uncommitted in this worktree.

## Checks

- GitNexus upstream impact: AgentServerService low risk, two direct importers; native signingKey/respond/capability low risk, one direct native caller each. No indexed affected processes.
- `node --experimental-vm-modules --test apps/electron/test/agent-server-ownership.test.mjs apps/electron/test/agent-server.test.mjs apps/electron/test/electron-e12b-native-signing.test.mjs`: 33 passed, 0 failed.
- `npm test` in apps/electron: 176 passed, 0 failed. Captured in `/tmp/rhythm-electron-startup-tests.log`.
- `npm run typecheck` in apps/electron: exit 0.
- `xcrun swiftc -O -framework Security -framework CryptoKit apps/electron/native/HumanApprovalSigner.swift -o /tmp/rhythm-approval-signer`: exit 0.
- Real CryptoKit native probe created, restored, signed and verified an enclave key on this Mac: true.
- Local app staged at `/Users/ajhochhalter/Applications/Rhythm Local Repair.app` using current Electron source, web dist, API dist and rebuilt helper. Existing bundled engine/dependencies reused; not a fresh release qualification build. Developer ID signed; initial deep strict codesign verification exited 0. Helper was then re-signed with the original `com.rhythm.desktop.approval-signer` identifier and enclosing bundle re-signed.
- Signed app launch PID 43960 blocked in saved-session Keychain access. Sample `/tmp/rhythm-launch-stack.txt` shows SecKeychainFindGenericPassword waiting for SecurityAgent.
- Signed native parent probe reached `capability()` after creating/restoring the new enclave identity, then waited in SecItemCopyMatching for the existing capability entry. Native signature/persistence completion remains unverified. Probe processes stopped to avoid stacking authorization prompts; app remains open for its authorization.
- Computer-control access to `com.apple.SecurityAgent` was refused for safety reasons. No attempt was made to automate its password dialog.
- API 4001 and engine 4096 have no listener. No claim of successful startup, no push, no production deployment.

## Notes

The first local helper signature accidentally used the default executable identifier. The new v3 test entry created by that helper in this run was removed, then the helper was re-signed with the installed helper's original identifier before retrying. No pre-existing v2 key or legacy capability item was deleted or changed. User authorization in macOS is still required to continue the live checks. Existing runtime reuse has unit evidence only; a live reuse/quit check remains required after actual startup succeeds.

## Later local verification and user acceptance

The earlier Keychain-blocked observations above are historical and superseded for the local repair candidate:
- Signed native parent/helper probe completed: persistent identity stable, real signature verified, no API requests.
- App started both real API and engine. Signed local UI loaded the authenticated workspace, profiles, models and existing session history. User reported this build working correctly.
- First workspace requests now wait for runtime readiness. Trusted Reload retains the encrypted login session while revoking old-document in-flight work.
- A separate copy of the Flutter database was imported into the Electron data directory using the bundled migration script; original Flutter database was preserved, imported scheduled jobs disabled, and the fresh Electron database backed up.
- `RHYTHM_LIVE_E2E=1 node --test apps/electron/test/agent-server-live.test.mjs`: real runtime reuse and non-owning disconnect passed; same engine boot ID and PID, usable profiles remained available.
- Fresh check: `npm test` in apps/electron: 177 passed, zero failed; `npm run typecheck`: exit 0.
- Fresh check: focused Google desktop exchange API suite: 5 passed.
- GitNexus detect-changes: low risk, expected OAuth/signing/startup symbols, no indexed affected processes.
- User requested integration into PR #1544 and a fresh package from the mega branch. Repairs were already in that branch's checkout; clean packaging is in progress.
- Local UI still displayed a pending-approvals load notification. No claim of complete approval-flow or mega-campaign qualification.

## Fresh mega-branch package

- Repair source commit c92c7544 pushed to draft PR #1544.
- Fresh package rebuilt engine, web, API, helper and production dependencies from that source. First packaging attempt with Homebrew Node failed due to its external libnode dylib; standalone Node 22 packaging succeeded.
- `npm run test:package`: 22 passed, zero failed, one env-gated live check skipped. Includes repeated package determinism, real packaged launch, isolation, single-instance and native dependency checks.
- Local package signing initially overlapped a test-triggered rebuild; signing was rerun sequentially after all package checks. Developer ID signature and deep strict verification then passed.
- Public Google desktop client configuration restored to the same value used by the accepted candidate. No secret embedded.
- Installed local candidate: `/Users/ajhochhalter/Applications/Rhythm Mega.app`; signed, not newly notarized.
- Launched with existing encrypted sign-in profile, Hermes enabled and port 9122 because an unrelated source Electron process owned 9121. Unrelated process preserved.
- UI navigation More > Hermes opened the embedded real dashboard, status Ready, existing Sessions content loaded. API 4001 and engine 4096 healthy; engine reports version 0.0.0-rhythm-c92c7544f4420324cebbaca8023d1e7f80c0d778.
- Live runtime reuse test passed again against the fresh installed candidate.
- Pending approvals/decisions load notices remain visible on the mega UI; no assertion of complete error-free application or full campaign qualification.
