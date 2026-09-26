## Goal

Stage the sealed, verified Colony artifact into the Mac package so the installed Rhythm app contains the renderer, scanner, assets and notices without any development tooling — and so the UI in M2 develops against the exact payload that ships.

Parent: #1525

Plan: [Colony in Rhythm Electron](https://github.com/ajhochy/Rhythm/blob/codex/colony-integration-plan/docs/ai/plans/2026-09-18-electron-colony.md)

Milestone: Colony M3 — Packaged Apple Silicon and Intel builds

## Dependencies

#1527, #1528

## Approach note (revised 2026-09-21)

**Reordered.** This previously depended on #1532 and #1533, placing packaging behind the entire UI and forcing COL-05 to develop against a fixture contract. Hermes landed the resolver, the packager staging, the re-seal step and the CI producer in the same foundational change as the view, so the interface and the shipped package never disagreed about what loads. This issue now depends only on M1 and runs in parallel with M2; #1530 depends on it.

## Likely files

- `apps/electron/scripts/package-mac.mjs` (new `stageColonyArtifact`, re-seal call)
- `apps/electron/src/colony-desktop-artifact.mjs`, `colony-desktop-config.mjs` (copied into the packaged app)
- `apps/electron/src/colony-service.mjs` and protocol resource lookup
- Proposed `apps/electron/test/colony-package.test.mjs`

## Requirements

- `stageColonyArtifact({ resources, artifactRoot = process.env.RHYTHM_COLONY_ARTIFACT_DIR })` throws when the variable is unset. Packaging must never assemble from an absent or unverified payload.
- Validate the source artifact against `PINNED_COLONY_SOURCE_COMMIT` and the runtime Electron major with `allowDirty: false`, copy it into immutable resources with `verbatimSymlinks`, then **re-validate at the destination**.
- Sign nested executables first; then call `refreshColonyArtifactIntegrity` on the staged artifact; then re-validate; then re-apply **only** the outer signature. `codesign` rewrites nested binaries, so sealing before signing guarantees a first-launch digest mismatch.
- Copy the resolver and config modules into the packaged app alongside the service, so the installed app performs the same validation the packager did.
- Extend the existing bundled Node path. Pin a supported exact Node patch and verify `node:sqlite`, architecture and worker startup before accepting a payload.
- Build with neutral environment inputs, stage only production resources, and store writable state in userData only. The app must start offline: no npm install, art download, Homebrew lookup or sibling checkout at runtime.
- Test a clean Mac with developer tools unavailable and no system Node; preserve task discovery with honest metadata degradation and no installation prompt.

## Acceptance criteria

- [ ] **COL-09-AC1:** The packaged app starts Colony against synthetic stores with the repository checkout unavailable and PATH containing no Node/npm; all assets and scanner capabilities load from the staged artifact.
- [ ] **COL-09-AC2:** Packaging with `RHYTHM_COLONY_ARTIFACT_DIR` unset, or pointing at a dirty/wrong-commit/corrupt artifact, fails the build with an actionable message; no development-path fallback masks it.
- [ ] **COL-09-AC3:** Removing or corrupting one staged artifact file after packaging produces a clear unavailable state at first launch rather than a partial or silently degraded Colony tab.
- [ ] **COL-09-AC4:** A repeat package build from identical pinned inputs produces matching app manifests; the re-seal step is the only source of post-signing manifest change, and the outer signature verifies strictly after it.
- [ ] **COL-09-AC5:** A payload inventory identifies source revision, exact Node/architecture and dependency/asset hashes; scans find no user data, fixture identities/tokens, inherited Vite secrets or developer-specific paths.
- [ ] **COL-09-AC6:** Packaging leaves local preferences untouched and records archive/installed-size deltas; offline enablement works with empty sources and populated fixtures.

## Required tests / evaluation

- Use the actual unsigned .app on the host architecture for no-checkout/no-PATH/offline/missing-resource/corrupted-file cases.
- A package test covering the unset-variable refusal, the destination re-validation and the seal/sign ordering.
- Run scanner/state tests with the exact packaged Node, including a real read-only SQLite fixture.
- Verify the manifest and all source/art/icon notices against the staged payload.

## Safety and scope

All-user opt-in; macOS Apple Silicon and Intel. Discovery is read-only; Colony writes only its own profile-scoped preferences/cache. No cloud upload of harness data, provider-secret changes, automatic agent turns, source deletions, or takeover/restart of live API/engine services. Use the canonical isolated sandbox for any needed backend smoke. New-session/terminal-resume actions and Flutter retirement are outside this plan. Work on a feature branch, capture required evidence and open a draft PR; human merge/release remains separate.
