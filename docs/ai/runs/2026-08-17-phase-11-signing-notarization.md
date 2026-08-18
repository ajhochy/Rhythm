---
date: 2026-08-17
repo: Rhythm
branch: codex/post-m1-phase-11-signing
pr: 1400
issues: []
status: pass
tags: [run, Rhythm]
---

## Files

- `apps/electron/scripts/sign-and-notarize-mac.mjs` (new)
- `apps/electron/entitlements/mac.plist` (new)
- `apps/electron/package.json` (`sign:mac` script)
- `.github/workflows/electron_release.yml` (new, not dispatched)
- `docs/ai/plans/2026-08-15-post-m1-parity-phases.md` (decision record updated)

## Checks

- `codesign --verify --deep --strict --verbose=2 dist/Rhythm.app`: valid, satisfies Designated Requirement.
- `xcrun notarytool submit ... --wait`: **Accepted** (second attempt; see Notes).
- `xcrun stapler validate dist/Rhythm.app`: worked.
- `spctl --assess --type execute --verbose dist/Rhythm.app`: accepted, source=Notarized Developer ID.
- `node --test --test-name-pattern="slice-7-c[2-6]" test/electron-unsigned-package.test.mjs`: 5/5 pass
  against the signed bundle (c1 excluded — it explicitly asserts NO Developer ID signing, which
  Phase 11 supersedes by design; not a regression).
- Full regression: fixture 209/210 (pre-existing post-m1-p7-c4d gap, unrelated), live 26/26 (one
  transient flake in phase-4-live under heavy concurrent load, reproduced clean 9/9 in isolation).

## Notes

AJ pointed at real local credentials (`~/Documents/Certificates & Keys/`) rather than CI secrets,
and directed build → launch → full Playwright suite against the live engine → PR, explicitly.

Found via `security find-identity`: 3 distinct "Developer ID Application: Aaron Hochhalter" certs
already in the login keychain (fingerprints CF6C1EF1.../3964FA13.../AE031F77...). Picked
`CF6C1EF1525E70E6E3324388A322938977779DB7` — standard 5-year validity (expires March 2031) vs. the
other two's unusual ~10-month windows (expire Feb 2027, likely leftover troubleshooting artifacts).
Documented so AJ can override if this guess is wrong. Notary credentials were unambiguous — a
maintained `AppStoreConnect-API-notary.txt` in the same folder explicitly names the working Key ID
(`9XHDX3ZN44`), Issuer ID, and key file, and explicitly warns off a second, non-working key.

First notarization attempt was correctly REJECTED by Apple (`statusCode: 4000`, "Archive contains
critical validation errors") for two nested Electron helper executables with no file extension —
`Electron Framework.framework/.../Helpers/chrome_crashpad_handler` and
`Squirrel.framework/.../Resources/ShipIt` — that the signing script's extension-based matching
(`.dylib`/`.so`/`.node`) silently skipped. Fixed by detecting Mach-O magic bytes (`0xfeedface` etc.)
instead of trusting file names, matching the same class of gap the Flutter reference script
(`tools/release/sign_and_notarize_macos.sh`) only avoids by explicitly special-casing its two known
extensionless binaries (bundled `node`, `opencode`). Re-signed; second submission Accepted.

A separate script bug (parsing notarytool's final `status:` line via a non-global regex, which
matched "In" out of "Current status: In Progress..." instead of the terminal "Accepted"/"Invalid")
was fixed alongside — cosmetic (the real Apple rejection was the actual blocker), but worth fixing
so the script's own exit code is trustworthy going forward.

`.github/workflows/electron_release.yml` (post-m1-p11-c3) is authored but not dispatched — running
it for real publishes an actual GitHub Release, which stays gated on AJ triggering it himself, same
as the desktop Flutter release workflow.

## What's left

- CI dispatch of `electron_release.yml` to prove the pipeline end-to-end (needs the repo's Apple
  secrets confirmed present; not attempted here).
- A clean-machine offline `stapler validate` + launch, to prove Gatekeeper acceptance without relying
  on this machine's cached OCSP/notarization state.
- AJ: confirm the chosen signing identity (CF6C1EF1...) is the intended one, not one of the two
  shorter-lived duplicates.
