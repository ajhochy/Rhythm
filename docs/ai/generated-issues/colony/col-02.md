## Goal

Expose the existing Colony data operations and 3D scene through explicit embedded contracts, without a public local HTTP server or broad native privileges.

Parent: {{EPIC}}  
Plan: [Colony in Rhythm Electron](https://github.com/ajhochy/Rhythm/blob/codex/colony-integration-plan/docs/ai/plans/2026-09-18-electron-colony.md)  
Milestone: Colony M1 — Foundation and local runtime

## Dependencies

{{COL-01}}

## Likely files

- Proposed apps/colony/server/service.mjs and embedded worker entry
- apps/colony/src/game/api.js and proposed embedded scene adapter
- Proposed apps/electron/src/colony-protocol.mjs and colony-policy.mjs
- apps/electron/src/main.mjs, preload.cjs; apps/web/index.html
- Proposed apps/shared/colony-contract.* and contract tests

## Requirements

- Extract shared service operations from the adopted API; keep the standalone HTTP adapter and its concurrency protections working. Define versioned DTOs and scene intents for selection, filters, camera, viewport, theme and visibility.
- Serve only the bundled scene from a fixed separate custom origin; use a document-bound MessageChannel and narrow preload entry points. Validate host/frame identity, current document generation, method and payload at each privileged boundary.
- Keep Node integration off and sandbox/context isolation/web security on. Do not enable bypassCSP or send auth/provider credentials to the scene. Pin implementation to APIs available in the existing Electron version.
- Bound control requests to 64 KiB, pages/chunks to 1 MiB and inventory pages to 250 records; large local state uses bounded chunks, a 32 MiB aggregate limit and one validated atomic commit. No silent truncation.

## Acceptance criteria

- [ ] **COL-02-AC1:** In real pinned Electron, bundled JS/GLB assets load and a synthetic scan plus state round-trip works through private child IPC; no Colony TCP listener is created and standalone HTTP behavior still passes.
- [ ] **COL-02-AC2:** A sibling/foreign frame, stale/reloaded document, unknown method, malformed/oversize message and unsupported protocol version each produce zero native actions and zero state writes.
- [ ] **COL-02-AC3:** The scene cannot access Rhythm bearer tokens, parent DOM, arbitrary URLs, filesystem APIs or process APIs; leaving/disabling the feature revokes the previous channel.
- [ ] **COL-02-AC4:** A 15,000-record snapshot is paged with stable generation/cursors and cancellation; a large archive beyond 64 KiB round-trips unchanged, while an interrupted state transfer commits nothing.

## Required tests / evaluation

- Add service parity tests over shared HTTP/embedded fixtures, including archive conflicts and cancellation.
- Run real Electron protocol/hostile-frame/message-lifetime tests on the pinned runtime; a plain browser test is not sufficient.
- Falsify one sender-validation check and one chunk/atomic-commit guard to show the tests catch the failure.

## Safety and scope

All-user opt-in; macOS Apple Silicon and Intel. Discovery is read-only; Colony writes only its own profile-scoped preferences/cache. No cloud upload of harness data, provider-secret changes, automatic agent turns, source deletions, or takeover/restart of live API/engine services. Use the canonical isolated sandbox for any needed backend smoke. New-session/terminal-resume actions and Flutter retirement are outside this plan. Work on a feature branch, capture required evidence and open a draft PR; human merge/release remains separate.
