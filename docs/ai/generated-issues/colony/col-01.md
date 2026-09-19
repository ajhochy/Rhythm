## Goal

Create a reproducible, reviewable source boundary for Colony in the Rhythm repository while retaining the working standalone data model and read-only harness behavior.

Parent: #1525

Plan: [Colony in Rhythm Electron](https://github.com/ajhochy/Rhythm/blob/codex/colony-integration-plan/docs/ai/plans/2026-09-18-electron-colony.md)

Milestone: Colony M1 — Foundation and local runtime

## Dependencies

None within this plan.

## Likely files

- Proposed apps/colony/ source, package.json and lockfile
- Proposed apps/colony/UPSTREAM.json and THIRD_PARTY_NOTICES.md
- Proposed scripts/update-colony-source.mjs
- Existing Bot Crossing package.json, LICENSE, tools/build-assets.mjs, public/assets, server and test directories as import inputs

## Requirements

- Review the exact Bot fork revision and its draft stack before adoption; candidate 36d2c29989f567de0ac4d30a957610163cfc4d86 includes ajhochy/bot-crossing#4. Record source URLs, commit, import manifest and patch/update process.
- Vendor a minimal pinned source/payload boundary under apps/colony; do not depend on a sibling checkout or git submodule being initialized at application launch.
- Inventory source/artwork/icon licensing from the actual shipped inputs and preserve notices. Exclude data/*.json, local native-openers configuration, .env, transcripts, private screenshots, user audio and development credentials.

## Acceptance criteria

- [ ] **COL-01-AC1:** A clean checkout can install from lockfiles, run the imported adapter/state tests and build the scene without an adjacent Bot Crossing checkout; the manifest identifies the exact imported commit.
- [ ] **COL-01-AC2:** Running the documented import/build twice with the same pinned inputs produces the same tracked source/asset inventory or explicitly documented nondeterministic build fields.
- [ ] **COL-01-AC3:** The imported fixture suite preserves task IDs, parent/worker relationships, repository/checkout grouping and local archive/viewed state; before/after source-store evidence shows no harness writes.
- [ ] **COL-01-AC4:** The staged payload inventory includes applicable notices and zero developer state, auth material or private session evidence; a missing/unlicensed asset is a build failure.

## Required tests / evaluation

- Run the adopted Node test suite and production build from apps/colony; retain existing synthetic regression coverage rather than replacing it with import-path assertions.
- Add an import manifest/inventory check and a negative fixture containing forbidden user-data files.
- Record asset size baseline and hash input manifest for later package comparison.

## Safety and scope

All-user opt-in; macOS Apple Silicon and Intel. Discovery is read-only; Colony writes only its own profile-scoped preferences/cache. No cloud upload of harness data, provider-secret changes, automatic agent turns, source deletions, or takeover/restart of live API/engine services. Use the canonical isolated sandbox for any needed backend smoke. New-session/terminal-resume actions and Flutter retirement are outside this plan. Work on a feature branch, capture required evidence and open a draft PR; human merge/release remains separate.
