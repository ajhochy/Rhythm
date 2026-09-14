---
date: 2026-09-12
repo: Rhythm
branch: feature/ios-account-connect
pr: null
issues: [ios-account-connect-A1]
status: ready_for_verification
tags: [run, Rhythm]
---

# iOS account connection transport A1

## Files

- `apps/mobile/lib/pairing/paired-host-store.ts`
- `apps/mobile/providers/paired-host-provider.tsx`
- `apps/mobile/tests/contract/ios-account-connect.test.mjs`
- `docs/ai/contracts/ios-account-connect.json`
- `docs/ai/runs/2026-09-12-ios-account-connect.md`

## Contract

- 9 criteria: 8 automated, 1 manual/native.
- Red run: `cd apps/mobile && node --test tests/contract/ios-account-connect.test.mjs`
  - Result before implementation: 0 passed, 8 failed.
  - Failure excerpt: `TypeError: store.restoreWithAccountBootstrap is not a function`.
- Green run: same command.
  - Result: 8 passed, 0 failed; duration 331.536 ms.
  - Fresh path metric: 2 cloud requests (`GET` list + `POST` connect), 1.89 ms measured in the in-process contract harness.
  - Restore path metric: 0 cloud bootstrap requests, 0.23 ms measured in the in-process contract harness; one Device-auth health validation remains intentional.

## Checks

- `npm run test:google-mobile-oauth` — pass (5 scenarios).
- `npm run test:rhythm-account` — pass (25 scenarios).
- `npm run test:paired-host` — pass (23 scenarios plus issue-1387 relay probe test).
- `npm run test:transport-clients` — pass (30 checks).
- `npm run test:connection-persistence` — pass.
- `npm run test:app-config` — pass.
- `npm run typecheck` — pass.
- `npm run lint` — pass with 3 pre-existing warnings in files outside this slice; 0 errors.
- `git diff --check` — pass.
- GitNexus pre-edit impact: `PairedHostStore` MEDIUM, `PairedHostProvider` LOW.
- GitNexus `detect_changes(scope=all)`: MEDIUM; owned provider/store symbols only, one existing pairing process affected.

## Notes

- Cloud Bearer is used only for `/relay/mobile-environments` discovery/grant calls. Existing chat transport continues to resolve the SecureStore device token and send `Authorization: Device`.
- Device tokens are written only to SecureStore; host/environment metadata remains secret-free in AsyncStorage.
- Provider contract adds `bootstrapState`, `environments`, `connectEnvironment`, and `retryBootstrap`; no screen/component changes were made.
- Current integrated behavior supersedes this slice's original 404 fallback: bootstrap 404 surfaces service unavailable with Retry and does not enter manual pairing. Manual pairing remains a separate path, not the Google-first fallback.
- Sandbox/native runtime was not started because approved fixture variables are unavailable and the sandbox fails closed as required.
- Native Google/Cloudflare acceptance is **not_tested** pending the integrated exact artifact and manager observation.
- No production access, credentials, deploy, push, commit, or manual server start occurred.
