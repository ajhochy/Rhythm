---
date: 2026-09-19
repo: Rhythm
branch: mega/2026-09-18-mobile-electron-hermes
pr: 1544
issues: []
status: repairing
tags: [run, Rhythm]
---

## Files

- No repair remains in source. Commit `20ca0f30` was reverted by `7345910e` after installed validation failed.

## Checks

- Original installed ARM qualification app showed the human-approval Keychain alert. At 11:25:41, macOS logged `SecKeyCreateRandomKey_ios failed` with `NSOSStatusErrorDomain Code=-34018` while adding a Secure Enclave key. The helper had no entitlements.
- A temporary helper `com.apple.application-identifier` entitlement built, signed, notarized, passed `codesign --verify`, and passed packaged smoke in ARM qualification run `35462034529`; those checks did not launch the native signer on the installed Mac.
- Installed launch of the new ARM artifact still showed the alert. At 11:57:21, `amfid` rejected `rhythm-approval-signer` before execution: `No matching profile found`; kernel reported restricted entitlements and a fatal code-signature validation failure. Therefore the entitlement-only repair is invalid for this standalone helper.
- The installed app did display its sign-in screen after the alert, but Google sign-in returned: `This Rhythm server does not support safe Google sign-in; update the server before signing in.` Neither local runtime nor authenticated desktop use was verified.
- Local Electron signer tests: 12 passed. Typecheck passed. Package tests: 22 passed, 1 skipped. These do not establish installed Keychain behavior.

## Notes

- Both qualification runs used `qualification_only=true`; no release was published. Run `35461825717` failed before signing because its version input was not numeric. Run `35462034529` was cancelled after the installed ARM artifact proved unusable.
- The next repair must use an Apple-supported provisioned app-like helper or another supported native persistence design, then validate the *installed* helper invocation on macOS. The server safe-sign-in deployment is a separate gate.
