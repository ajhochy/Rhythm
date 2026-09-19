## Goal

Let Electron lazily start, supervise and stop one Colony scanner while preserving the ownership of every existing Rhythm and harness process.

Parent: {{EPIC}}  
Plan: [Colony in Rhythm Electron](https://github.com/ajhochy/Rhythm/blob/codex/colony-integration-plan/docs/ai/plans/2026-09-18-electron-colony.md)  
Milestone: Colony M1 — Foundation and local runtime

## Dependencies

{{COL-02}}

## Likely files

- Proposed apps/electron/src/colony-service.mjs
- apps/electron/src/main.mjs and preload.cjs
- apps/colony/server embedded entry and source-discovery configuration
- Proposed apps/electron/test/colony-ownership.test.mjs

## Requirements

- Use the packaged Node executable and absolute packaged scanner entry, with an explicit version/capability handshake and sanitized environment. Packaged mode must never fall back to a developer checkout or ambient PATH.
- Start only after local opt-in and first use; serialize concurrent starts. Define startup timeout, bounded restart attempts and user-visible recovery status. Stop only the child/process group spawned by this service.
- Resolve enabled source paths on the main/worker side. Source toggles are applied before opening stores; aggregate per-source failures while retaining healthy results.

## Acceptance criteria

- [ ] **COL-03-AC1:** With Colony disabled, normal app startup performs zero harness reads and creates zero Colony children. Ten concurrent enable/open events create one scanner; repeated tab use does not create another.
- [ ] **COL-03-AC2:** With live API/engine sentinel processes already running, scanner start, crash, retry, disable and app quit leave their PIDs/listeners unchanged and never bind/reclaim their ports.
- [ ] **COL-03-AC3:** Removing the packaged Node/scanner payload produces a clear unavailable state with no attempt to run system Node or a checkout; a version mismatch fails the handshake before scanning.
- [ ] **COL-03-AC4:** A disabled source is never opened; missing, locked or malformed source fixtures are diagnosed individually while healthy harness tasks remain visible. Worker crash loops stop at the documented retry bound.

## Required tests / evaluation

- Use disposable fake child processes for deterministic ownership/startup/crash tests and verify unrelated sentinels survive.
- Run a real packaged-Node worker against sanitized read-only harness fixtures and inspect listener/process receipts.
- Snapshot/hash fixture stores before and after scanning; no harness DB/transcript writes are permitted.

## Safety and scope

All-user opt-in; macOS Apple Silicon and Intel. Discovery is read-only; Colony writes only its own profile-scoped preferences/cache. No cloud upload of harness data, provider-secret changes, automatic agent turns, source deletions, or takeover/restart of live API/engine services. Use the canonical isolated sandbox for any needed backend smoke. New-session/terminal-resume actions and Flutter retirement are outside this plan. Work on a feature branch, capture required evidence and open a draft PR; human merge/release remains separate.
