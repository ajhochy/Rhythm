---
date: 2026-09-19
repo: Rhythm
branch: mega/2026-09-18-mobile-electron-hermes
pr: 1544
issues: []
status: pending
tags: [run, Rhythm]
---

## Files

- `apps/electron/scripts/sign-and-notarize-mac.mjs`: sign the native approval helper with a team-bound macOS application identifier so its Secure Enclave key can be saved in the Data Protection Keychain.

## Checks

- Installed qualification app failed at 11:25:41 local time. Unified log showed `SecKeyCreateRandomKey_ios failed` with `NSOSStatusErrorDomain Code=-34018` while adding the key; this is `errSecMissingEntitlement`.
- Installed helper's `codesign -d --entitlements -` output contained no entitlements. App and helper signatures verified; helper lock directory and file had expected owner/modes.
- `node --experimental-vm-modules --test test/electron-e12b-native-signing.test.mjs`: 12 passed.
- `npm run typecheck`: passed.
- `npm run test:package`: 22 passed, 1 skipped.
- `gitnexus detect-changes --scope unstaged --repo <integration worktree>`: low risk, 0 affected processes (index rebuilt before check).

## Notes

- The displayed instruction to unlock the Mac is misleading for this failure. No installed-app or Keychain state was changed during diagnosis.
- A fresh Developer ID signed package and installed launch are still required to verify that the entitlement resolves the runtime failure. The existing qualification app remains the prior build.
