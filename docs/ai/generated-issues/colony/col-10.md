## Goal

Build and verify Colony through the existing architecture-specific Electron signing/notarization pipeline.

Parent: {{EPIC}}  
Plan: [Colony in Rhythm Electron](https://github.com/ajhochy/Rhythm/blob/codex/colony-integration-plan/docs/ai/plans/2026-09-18-electron-colony.md)  
Milestone: Colony M3 — Packaged Apple Silicon and Intel builds

## Dependencies

{{COL-09}}

## Likely files

- .github/workflows/electron_release.yml
- apps/electron/scripts/sign-and-notarize-mac.mjs
- apps/electron/scripts/package-mac.mjs and package receipt tooling
- Proposed signed Colony smoke entry/configuration

## Requirements

- Retain native arm64/x64 jobs and separate Rhythm-arm64.zip/Rhythm-x64.zip artifacts. Do not create a competing release channel or require universal binary assembly.
- Sign all nested executable payloads before sealing the app, notarize/staple, verify codesign/spctl and run Colony smoke against the final signed bundle.
- Publish/attach manifests, artifact hashes and test receipts through the existing approved release procedure; never embed signing credentials or runtime auth tokens. This issue implementation must not auto-publish without release authorization.

## Acceptance criteria

- [ ] **COL-10-AC1:** Both native architecture jobs build with the pinned inputs and confirm matching Electron/Node/scanner architecture and node:sqlite capability.
- [ ] **COL-10-AC2:** The exact final .app for each architecture passes strict signature assessment and notarization/staple checks, then a signed-bundle Colony enable/scan/disable smoke.
- [ ] **COL-10-AC3:** Downloaded final ZIP hashes match the published manifest, and extracted bundles preserve signatures and required licenses; an invalid/missing payload blocks that architecture from release.
- [ ] **COL-10-AC4:** Missing signing credentials or unavailable architecture execution is an explicit failed/open gate rather than a skipped pass; no unsigned artifact is represented as release-qualified.

## Required tests / evaluation

- Inspect both CI runs and retain artifact/version/SHA/architecture receipts.
- Use the actual final signed artifacts for smoke; unsigned source Electron or browser e2e does not substitute.
- Validate release notes and artifact naming remain within the existing Electron prerelease policy.

## Safety and scope

All-user opt-in; macOS Apple Silicon and Intel. Discovery is read-only; Colony writes only its own profile-scoped preferences/cache. No cloud upload of harness data, provider-secret changes, automatic agent turns, source deletions, or takeover/restart of live API/engine services. Use the canonical isolated sandbox for any needed backend smoke. New-session/terminal-resume actions and Flutter retirement are outside this plan. Work on a feature branch, capture required evidence and open a draft PR; human merge/release remains separate.
