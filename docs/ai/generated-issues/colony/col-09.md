## Goal

Make the installed Rhythm app contain the Colony renderer, scanner, assets and compatible runtime without requiring development tooling.

Parent: #1525

Plan: [Colony in Rhythm Electron](https://github.com/ajhochy/Rhythm/blob/codex/colony-integration-plan/docs/ai/plans/2026-09-18-electron-colony.md)

Milestone: Colony M3 — Packaged Apple Silicon and Intel builds

## Dependencies

#1528, #1532, #1533

## Likely files

- apps/electron/scripts/package-mac.mjs
- Proposed Colony payload manifest/build script
- apps/electron/src/colony-service.mjs and protocol resource lookup
- apps/colony/ lockfile, production payload and notices
- Proposed apps/electron/test/colony-package.test.mjs

## Requirements

- Extend the existing packager and bundled Node 22 path. Pin a supported exact Node patch >=22.13 and verify node:sqlite, architecture and worker startup before accepting a payload.
- Build with neutral environment inputs, stage only production resources and preserve licenses/source provenance. Store writable state in userData only.
- Package the renderer/GLB assets so it can start offline; no npm install, art download, Homebrew lookup or sibling checkout may be needed at runtime.

- Test a clean Mac with Git/developer tools unavailable as well as no system Node; preserve task discovery with honest metadata degradation and no installation prompt.

## Acceptance criteria

- [ ] **COL-09-AC1:** The packaged app starts Colony against synthetic stores with the repo checkout unavailable and PATH containing no Node/npm; all assets and scanner capabilities load from the bundle.
- [ ] **COL-09-AC2:** Removing or corrupting a declared resource fails package validation or produces a clear unavailable state at runtime; no development-path fallback masks the failure.
- [ ] **COL-09-AC3:** A payload inventory identifies source revisions, exact Node/architecture and dependency/asset hashes; scans find no user data, fixture identities/tokens, inherited Vite secrets or developer-specific paths.
- [ ] **COL-09-AC4:** Packaging leaves local preferences untouched and records archive/installed-size deltas; offline enablement works with empty sources and populated fixtures.

## Required tests / evaluation

- Use the actual unsigned .app on the host architecture for no-checkout/no-PATH/offline/missing-resource cases.
- Run adopted scanner/state tests with the exact packaged Node, including a real read-only SQLite fixture.
- Verify manifest and all source/art/icon notices against the staged payload.

## Safety and scope

All-user opt-in; macOS Apple Silicon and Intel. Discovery is read-only; Colony writes only its own profile-scoped preferences/cache. No cloud upload of harness data, provider-secret changes, automatic agent turns, source deletions, or takeover/restart of live API/engine services. Use the canonical isolated sandbox for any needed backend smoke. New-session/terminal-resume actions and Flutter retirement are outside this plan. Work on a feature branch, capture required evidence and open a draft PR; human merge/release remains separate.
