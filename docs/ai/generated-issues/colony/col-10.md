## Goal

Make release CI the producer of the pinned Colony artifact, then build and verify Colony through the existing architecture-specific Electron signing/notarization pipeline.

Parent: #1525

Plan: [Colony in Rhythm Electron](https://github.com/ajhochy/Rhythm/blob/codex/colony-integration-plan/docs/ai/plans/2026-09-18-electron-colony.md)

Milestone: Colony M3 — Packaged Apple Silicon and Intel builds

## Dependencies

#1534

## Approach note (revised 2026-09-21)

Hermes review caught that package assembly required the pinned artifact while release CI had no producer for it. That was fixed in the same change rather than at release time. This issue makes that step explicit for Colony: CI clones the pin and builds the artifact; it never consumes a developer's local build.

## Likely files

- `.github/workflows/electron_release.yml`
- `apps/electron/scripts/sign-and-notarize-mac.mjs`
- `apps/electron/scripts/package-mac.mjs` and package receipt tooling
- Proposed signed Colony smoke entry/configuration

## Requirements

- Add a checkout step that reads `PINNED_COLONY_SOURCE_COMMIT` from `apps/electron/src/colony-desktop-config.mjs`, validates it matches `^[0-9a-f]{40}$` with a real bash regex test (`[[ ... =~ ... ]]`, not `test ... =~` — the Hermes review caught exactly this error), fetches that revision from the Bot Crossing repository at depth 1, and asserts the checked-out revision equals the pin.
- Add a build step that asserts the runner architecture matches `RHYTHM_PACKAGE_ARCH`, installs upstream dependencies from the lockfile, runs `build:rhythm-embedded` with CI revision environment variables cleared, asserts `manifest.json` exists, and exports `RHYTHM_COLONY_ARTIFACT_DIR` — all **before** package contracts and assembly.
- Retain native arm64/x64 jobs and separate `Rhythm-arm64.zip` / `Rhythm-x64.zip` artifacts. Do not create a competing release channel or require universal binary assembly.
- Sign all nested executable payloads before sealing, re-seal the artifact manifest, re-sign only the outer app, notarize/staple, verify codesign/spctl, and run Colony smoke against the final signed bundle.
- Publish/attach manifests, artifact hashes and test receipts through the existing approved release procedure; never embed signing credentials or runtime auth tokens. This implementation must not auto-publish without release authorization.

## Acceptance criteria

- [ ] **COL-10-AC1:** Both native architecture jobs check out the exact pinned revision, fail loudly if the fetched revision differs, build the artifact on the native architecture and confirm matching Electron/Node/scanner architecture and `node:sqlite` capability.
- [ ] **COL-10-AC2:** The revision-validation line is executed as a workflow contract test against both a valid 40-hex value and invalid values, and rejects the invalid ones.
- [ ] **COL-10-AC3:** The exact final .app for each architecture passes strict signature assessment and notarization/staple checks, then a signed-bundle Colony enable/scan/disable smoke.
- [ ] **COL-10-AC4:** Downloaded final ZIP hashes match the published manifest, and extracted bundles preserve signatures, artifact integrity and required licences; an invalid or missing payload blocks that architecture from release.
- [ ] **COL-10-AC5:** Missing signing credentials or unavailable architecture execution is an explicit failed/open gate rather than a skipped pass; no unsigned artifact is represented as release-qualified.

## Required tests / evaluation

- Inspect both CI runs and retain artifact/version/SHA/architecture receipts.
- Use the actual final signed artifacts for smoke; unsigned source Electron or browser e2e does not substitute.
- YAML parse plus a runtime/config test for the extracted pin and the validation line.
- Validate release notes and artifact naming remain within the existing Electron prerelease policy.

## Safety and scope

All-user opt-in; macOS Apple Silicon and Intel. Discovery is read-only; Colony writes only its own profile-scoped preferences/cache. No cloud upload of harness data, provider-secret changes, automatic agent turns, source deletions, or takeover/restart of live API/engine services. Use the canonical isolated sandbox for any needed backend smoke. New-session/terminal-resume actions and Flutter retirement are outside this plan. Work on a feature branch, capture required evidence and open a draft PR; human merge/release remains separate.
