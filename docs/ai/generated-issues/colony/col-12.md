## Goal

Prepare a supportable opt-in Colony release for all Rhythm Electron users while retaining the host app release and cutover boundaries.

Parent: {{EPIC}}  
Plan: [Colony in Rhythm Electron](https://github.com/ajhochy/Rhythm/blob/codex/colony-integration-plan/docs/ai/plans/2026-09-18-electron-colony.md)  
Milestone: Colony M4 — Installed acceptance and opt-in rollout

## Dependencies

{{COL-11}}

## Likely files

- Proposed docs/release/colony-rollout.md and support guide
- docs/testing/manual-smoke.md and docs/ai/project-state.md
- Electron release notes/checklist and local feature settings documentation

## Requirements

- Document the local-only data model, supported harness/action matrix, source permissions, archive semantics, import/backup behavior, disablement and troubleshooting.
- Provide an artifact-specific approval checklist and bounded pilot using the signed builds from COL-11; rollout remains default-off and each profile opts in locally.
- Keep host Electron release readiness and Flutter retirement separate. Reuse the host update mechanism; if updates are manual ZIP replacement, test/document that rather than asserting automatic updater coverage.
- Prepare a rollback procedure that disables Colony and/or restores the previous compatible signed host plus local state backup without changing harness data.

## Acceptance criteria

- [ ] **COL-12-AC1:** The release packet links all required issue/test/artifact receipts and identifies the human release decision; missing architecture/signing/installed evidence keeps this issue open.
- [ ] **COL-12-AC2:** A new user receives the approved Electron build with Colony off, can understand and enable it locally, and can disable it without losing preferences or affecting ongoing agents.
- [ ] **COL-12-AC3:** The documented upgrade/rollback procedure is rehearsed with a preserved preference fixture and leaves source records and unrelated services unchanged.
- [ ] **COL-12-AC4:** The feature can be approved for all-user opt-in distribution without implying that global Electron replacement, production provider or Flutter cutover gates have passed; no release is published solely by closing this issue.

## Required tests / evaluation

- Perform a documentation walkthrough against the exact installed candidate and capture the bounded pilot/rollback result.
- Verify support instructions, artifact links and compatibility matrix match the tested build.

## Safety and scope

All-user opt-in; macOS Apple Silicon and Intel. Discovery is read-only; Colony writes only its own profile-scoped preferences/cache. No cloud upload of harness data, provider-secret changes, automatic agent turns, source deletions, or takeover/restart of live API/engine services. Use the canonical isolated sandbox for any needed backend smoke. New-session/terminal-resume actions and Flutter retirement are outside this plan. Work on a feature branch, capture required evidence and open a draft PR; human merge/release remains separate.
