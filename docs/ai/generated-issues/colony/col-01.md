## Goal

Pin an exact upstream Bot Crossing revision and have that upstream project emit a sealed, integrity-verified embedded artifact that Rhythm can consume. Rhythm holds a pinned commit constant and nothing else — no vendored source tree.

Parent: #1525

Plan: [Colony in Rhythm Electron](https://github.com/ajhochy/Rhythm/blob/codex/colony-integration-plan/docs/ai/plans/2026-09-18-electron-colony.md)

Milestone: Colony M1 — Foundation and local runtime

## Dependencies

None within this plan.

## Approach note (revised 2026-09-21)

This follows the Hermes Desktop precedent (`6ed3ba03`; `apps/electron/src/hermes-desktop-config.mjs`, `src/hermes-desktop-artifact.mjs`). The earlier draft of this issue vendored a source copy into `apps/colony/` with `UPSTREAM.json` and import tooling. That is replaced: upstream stays upstream, and the integration surface is a build artifact, not a codebase. It removes the merge/drift burden and the duplicate test suite, and it is what made the Hermes integration go smoothly.

## Likely files

- Bot Crossing (upstream): `apps/desktop`-equivalent `build:rhythm-embedded` script and its own test
- Bot Crossing (upstream): notice/licence staging into the artifact output
- Rhythm: new `apps/electron/src/colony-desktop-config.mjs` exporting `PINNED_COLONY_SOURCE_COMMIT`
- Rhythm: `docs/ai/plans/2026-09-18-electron-colony.md` pinned build inputs

## Requirements

- Review the exact Bot fork revision and its draft stack before pinning; candidate `36d2c29989f567de0ac4d30a957610163cfc4d86` includes ajhochy/bot-crossing#4. Do not track a moving branch.
- Add `build:rhythm-embedded` upstream. It emits `build/rhythm-embedded/` containing the renderer entry, the scanner host entry, the preload entry, all required third-party notices, and `manifest.json`.
- `manifest.json` schema: `schemaVersion` (1), `product` (`colony`), `sourceCommit` (40-hex), `electronMajor`, `dirty`/`sourceDirty` booleans, `files` mapping the required entry points (`renderer`, `host`, `preload`) to artifact-relative paths, and `integrity` mapping **every** file in the tree to a `sha256-<base64>` SRI digest.
- The builder refuses to emit a clean manifest from a dirty working tree, and records the source revision it actually built. It writes no symlinks and no absolute paths.
- Rhythm stores only `PINNED_COLONY_SOURCE_COMMIT`. There is no `apps/colony/` source tree, no import script, no submodule and no sibling-checkout requirement.
- Record the pinned build inputs in the plan: source revision, Electron major, exact Node patch (with `node:sqlite` support) and minimum macOS version. The Electron major is decided here, not discovered downstream — Hermes found Electron 33 shipped Node 20 without global WebSocket and had to move Rhythm to 40.10.2.
- Exclude `data/*.json`, local native-openers configuration, `.env`, transcripts, private screenshots, user audio and development credentials from the artifact.

## Acceptance criteria

- [ ] **COL-01-AC1:** A clean upstream checkout at the pinned revision runs `build:rhythm-embedded` and emits an artifact whose `manifest.json` names that exact revision, the agreed `electronMajor`, and the three required entry points; no adjacent Rhythm checkout is needed.
- [ ] **COL-01-AC2:** Running the builder twice on the same pinned inputs produces identical `integrity` digests, or the nondeterministic fields are explicitly documented and excluded from the seal.
- [ ] **COL-01-AC3:** Building from a dirty working tree either fails or sets `dirty: true`; every file in the emitted tree appears in `integrity`, and the tree contains no symlink, no absolute path and no excluded developer/user data.
- [ ] **COL-01-AC4:** The artifact contains the applicable MIT/CC0/Apache-2.0 notices for the shipped inventory, covered by `integrity` so they cannot drift from the code; a missing or unlicensed asset fails the build. Asset size baseline is recorded for later package comparison.
- [ ] **COL-01-AC5:** The upstream adapter/state test suite still passes at the pinned revision, preserving task IDs, parent/worker relationships, repository/checkout grouping and local archive/viewed state; before/after source-store evidence shows no harness writes.

## Required tests / evaluation

- Upstream: a builder test asserting manifest shape, full integrity coverage, dirty-tree refusal and the excluded-path denylist (Hermes analogue: `build-embedded-artifact.test.mjs`).
- Upstream: run the existing adapter/state suite and production build at the pinned revision; retain the synthetic regression coverage rather than replacing it with build-path assertions.
- Record the artifact file count, asset size baseline and hash input manifest for later package comparison.

## Safety and scope

All-user opt-in; macOS Apple Silicon and Intel. Discovery is read-only; Colony writes only its own profile-scoped preferences/cache. No cloud upload of harness data, provider-secret changes, automatic agent turns, source deletions, or takeover/restart of live API/engine services. Use the canonical isolated sandbox for any needed backend smoke. New-session/terminal-resume actions and Flutter retirement are outside this plan. Work on a feature branch, capture required evidence and open a draft PR; human merge/release remains separate.
