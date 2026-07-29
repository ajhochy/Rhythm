# Project State

## Current focus

2026-07-29: v0.18.53 published (run 30496034693) but is **dead on arrival** —
AMFI SIGKILLs it at launch because the new `keychain-access-groups` restricted
entitlement shipped without an embedded Developer ID provisioning profile.
Repair in flight: embed the profile + `com.apple.application-identifier` at
release signing, and add a launch smoke so a DOA app can never pass CI again.

## Active branch / PR

- Branch: `fix/desktop-devid-provisioning-profile`, based on `main` at
  `9ae77f5f8`.
- Run record:
  [runs/2026-07-29-devid-provisioning-profile.md](runs/2026-07-29-devid-provisioning-profile.md).
- Prior repair (verifier + sed expansion) merged as PR
  [#1250](https://github.com/ajhochy/Rhythm/pull/1250); flaky mobile nav
  locator fix open as PR
  [#1252](https://github.com/ajhochy/Rhythm/pull/1252).

## In progress

- CI on the provisioning-profile branch, then merge and dispatch Desktop
  Release v0.18.54 (v0.18.53 assets stay up but are unusable; do not reuse the
  tag).

## Risks / known issues

- v0.18.53 is published and DOA for anyone who downloads it; users should
  stay on v0.18.52 until v0.18.54 ships.
- `APPLE_PROVISIONING_PROFILE_BASE64` repo secret contains profile "Rhythm
  Developer ID" (expires 2044) bound to the CI signing cert (expires
  2027-02-01). Rotating the signing cert requires regenerating the profile.
- Approvals: the server (deployed to production at `9ae77f5f8`) hard-requires
  signed human decisions; no shipped client can sign until v0.18.54, so new
  agent approvals are effectively frozen until it ships.
- Production API deployed and healthy on `9ae77f5f8` (Synology un-pinned from
  `sha-80d1552`; stray `AGENT_LOCAL=true` removed from `.env.production` —
  it was forcing a loopback bind under new main and had been silently
  bypassing JWT on hosted agent endpoints).
- TestFlight upload is paused (production iOS 1.0.8 build 2 IPA from
  `125df4747` verified locally, not uploaded).
- Pre-existing `DB_CLIENT=postgres` + `RHYTHM_ROLE=all` stream-bridge
  reconciliation error:
  [postgres-all-role-stream-bridge-reconciliation.md](generated-issues/postgres-all-role-stream-bridge-reconciliation.md).

## Test status

- Release regression (skill_schema_parity): red on unfixed scripts → 13/13
  green with the profile/identifier/launch-smoke pins.
- `bash -n` + `shellcheck` on both release scripts; `tsc --noEmit` clean.
- Local dress rehearsal with the real CI cert: shipped v0.18.53 app +
  embedded profile + application-identifier launches and runs; new verifier
  passes it end-to-end (incl. launch smoke) and fails shipped v0.18.53 with
  a precise message.
- Also fixed a pre-existing pipefail/SIGPIPE race in
  `require_codesign_detail` that could flake any release verify step.

## Next step

Green CI on `fix/desktop-devid-provisioning-profile` → merge (user
pre-authorized) → dispatch Desktop Release v0.18.54 from updated `main` →
verify launch on a real Mac → then TestFlight and PR #1252 merge.
