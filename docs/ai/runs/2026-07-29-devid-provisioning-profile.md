---
date: 2026-07-29
repo: Rhythm
branch: fix/desktop-devid-provisioning-profile
pr: pending
issues: []
status: ci-pending
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# Developer ID provisioning profile for restricted keychain entitlement

## Problem

v0.18.53 (run 30496034693) passed every CI gate — build, smoke, signing,
notarization, and the repaired entitlement verifier — yet was **dead on
arrival**: AMFI SIGKILLs it at exec on user machines
("The application 'Rhythm.app' can't be opened", exit 137).

Root cause: `keychain-access-groups` (added by e0bdd587a for
HumanApprovalSigner) is a **restricted** entitlement. A Developer ID app may
carry it only when an embedded Developer ID provisioning profile authorizes
it. Release signing embedded no profile. Notarization does not check profile
authorization; only launch-time AMFI does. v0.18.53 was the first release
ever to carry a restricted entitlement, which is why every prior release
worked with identical credentials.

Proven by local differential test: a pristine copy of the shipped app is
killed (137) even dequarantined; the identical copy re-signed without the
entitlement launches; the copy re-signed WITH the entitlement + embedded
Developer ID profile + `com.apple.application-identifier` launches.

## Files changed

- `tools/release/sign_and_notarize_macos.sh` — requires
  `APPLE_PROVISIONING_PROFILE_BASE64`, decodes it to
  `Contents/embedded.provisionprofile` before the outer codesign, and injects
  `com.apple.application-identifier` (`${TEAM}.${BUNDLE}`) into the processed
  entitlements (the Data Protection Keychain requires it at runtime).
- `tools/release/verify_desktop_oauth_build.sh` — signed mode now requires
  the application-identifier entitlement (exact value), an embedded
  ProvisionsAllDevices (Developer ID) profile, and — decisive for this class —
  `require_launch_smoke`: launches the signed app and fails if it dies within
  5s. Also fixed a pre-existing pipefail/SIGPIPE race in
  `require_codesign_detail` (`codesign | grep -q` can report failure on a
  successful match when codesign's residual writes die of SIGPIPE).
- `.github/workflows/desktop_release.yml` — passes the new secret.
- `apps/api_server/src/__tests__/skill_schema_parity.test.ts` — pins the
  whole chain (workflow secret, signer embed + identifier injection, verifier
  requirements incl. launch smoke).

## Secrets

- `APPLE_PROVISIONING_PROFILE_BASE64` added to repo secrets: profile
  "Rhythm Developer ID" (Developer ID Application, org.visaliacrc.rhythm,
  expires 2044-07-24), contains exactly the CI signing cert
  (SHA1 3964FA13..., expires 2027-02-01). If the CI signing cert is ever
  rotated, the profile must be regenerated with the new cert.

## Checks run

- Red regression on unfixed scripts, then 13/13 green after the fix.
- `bash -n` + `shellcheck` on both release scripts — passed.
- `tsc --noEmit` — passed.
- Local dress rehearsal with the real CI cert: shipped v0.18.53 app +
  embedded profile + application-identifier, re-signed → launches and runs.
- New verifier end-to-end: PASSES the fixed app (including launch smoke),
  FAILS shipped v0.18.53 with "missing entitlement
  'com.apple.application-identifier'".

## Notes

- v0.18.53 assets remain published but are DOA; v0.18.54 supersedes.
- Server-side approvals now hard-require signed decisions, so shipping a
  working signer (not stripping the entitlement) was the only viable fix.
