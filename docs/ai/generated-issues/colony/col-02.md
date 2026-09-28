## Goal

Verify the sealed Colony artifact before Rhythm's privileged process imports it, then expose the Colony data operations and 3D scene through explicit embedded contracts — without a public local HTTP server, broad native privileges, or any fallback loading path.

Parent: #1525

Plan: [Colony in Rhythm Electron](https://github.com/ajhochy/Rhythm/blob/codex/colony-integration-plan/docs/ai/plans/2026-09-18-electron-colony.md)

Milestone: Colony M1 — Foundation and local runtime

## Dependencies

#1526

## Approach note (revised 2026-09-21)

Adds the artifact resolver, modelled on `apps/electron/src/hermes-desktop-artifact.mjs`. The earlier draft had no integrity/refusal contract at all — only "a packaged app with missing resources must fail clearly." Refusing an unprovable artifact with no fallback is the specific reason the Hermes integration never produced a "works in dev, broken installed" build.

## Likely files

- Proposed `apps/electron/src/colony-desktop-artifact.mjs` (resolver + re-seal helper)
- Proposed `apps/electron/test/colony-desktop-artifact.test.mjs`
- Proposed `apps/electron/src/colony-protocol.mjs` and `colony-policy.mjs`
- `apps/electron/src/main.mjs`, `preload.cjs`; `apps/web/index.html`
- Upstream embedded service/worker entry and scene adapter (`src/game/api.js` seam)
- Proposed `apps/shared/colony-contract.*` and contract tests

## Requirements

**Artifact verification.** `resolveColonyArtifact({ artifactRoot, expectedElectronMajor, expectedSourceCommit, allowDirty })` validates before any import and throws an actionable error on each of:

- missing artifact root, or a missing/unreadable/non-object `manifest.json`
- `schemaVersion` or `product` mismatch
- `sourceCommit` that is not 40-hex, or does not equal `PINNED_COLONY_SOURCE_COMMIT`
- `electronMajor` not equal to the running Electron major
- `dirty` or `sourceDirty` true (unless `allowDirty` is explicitly set), or either present but non-boolean
- empty `integrity`, a duplicate entry, a malformed SRI value, or any digest mismatch
- any file present in the tree but absent from `integrity`
- any symlink, any non-regular entry, any absolute manifest path, or any path escaping the artifact root
- a missing or unverified `renderer`, `host` or `preload` entry

There is **no** development-mode loading path, **no** `BOT_CROSSING_DATA` PATH lookup and **no** degraded standalone fallback. The single seam is `RHYTHM_COLONY_ARTIFACT_DIR`, which must point at a real built artifact passing identical validation; `allowDirty` is the only relaxation and is never set in packaging or CI.

Also provide `refreshColonyArtifactIntegrity({ artifactRoot })` for the post-codesign re-seal used by COL-09.

**Embedded contracts.** Extract shared service operations from the upstream API; keep the standalone HTTP adapter working upstream. Define versioned DTOs and scene intents for selection, filters, camera, viewport, theme and visibility. Serve only the verified artifact's renderer entry on a fixed separate origin; use a document-bound MessageChannel and narrow preload entry points, validating host/frame identity, current document generation, method and payload at each privileged boundary. Keep Node integration off and sandbox/context isolation/web security on; never enable `bypassCSP`; never send auth/provider credentials to the scene. Bound control requests to 64 KiB, pages/chunks to 1 MiB and inventory pages to 250 records; large local state uses bounded chunks, a 32 MiB aggregate limit and one validated atomic commit. No silent truncation.

## Acceptance criteria

- [ ] **COL-02-AC1:** Each refusal case above is covered by a direct unit test and produces a distinct actionable error with zero import, zero native action and zero state write. Corrupting one byte of one artifact file fails the load.
- [ ] **COL-02-AC2:** With `RHYTHM_COLONY_ARTIFACT_DIR` unset or pointing at a missing, dirty, wrong-commit or wrong-`electronMajor` artifact, the Colony tab reports why and stops; no alternative source is loaded and no partial UI is shown.
- [ ] **COL-02-AC3:** In real pinned Electron, artifact-served JS/GLB assets load and a synthetic scan plus state round-trip works through private child IPC; no Colony TCP listener is created and upstream standalone HTTP behavior still passes.
- [ ] **COL-02-AC4:** A sibling/foreign frame, stale/reloaded document, unknown method, malformed/oversize message and unsupported protocol version each produce zero native actions and zero state writes.
- [ ] **COL-02-AC5:** The scene cannot access Rhythm bearer tokens, parent DOM, arbitrary URLs, filesystem APIs or process APIs; leaving/disabling the feature revokes the previous channel.
- [ ] **COL-02-AC6:** A 15,000-record snapshot is paged with stable generation/cursors and cancellation; a large archive beyond 64 KiB round-trips unchanged, while an interrupted state transfer commits nothing.

## Required tests / evaluation

- A dedicated resolver test file exercising every refusal rule with fixture artifacts, kept separate from the live/native suite.
- Service parity tests over shared HTTP/embedded fixtures, including archive conflicts and cancellation.
- Real Electron protocol/hostile-frame/message-lifetime tests on the pinned runtime; a plain browser test is not sufficient.
- Falsify one sender-validation check, one integrity check and one chunk/atomic-commit guard to show the tests catch the failure.

## Safety and scope

All-user opt-in; macOS Apple Silicon and Intel. Discovery is read-only; Colony writes only its own profile-scoped preferences/cache. No cloud upload of harness data, provider-secret changes, automatic agent turns, source deletions, or takeover/restart of live API/engine services. Use the canonical isolated sandbox for any needed backend smoke. New-session/terminal-resume actions and Flutter retirement are outside this plan. Work on a feature branch, capture required evidence and open a draft PR; human merge/release remains separate.
