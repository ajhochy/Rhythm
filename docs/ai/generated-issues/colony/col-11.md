## Goal

Prove that real users can install, enable and use Colony from the distributed signed apps on both supported Mac architectures.

Parent: #1525

Plan: [Colony in Rhythm Electron](https://github.com/ajhochy/Rhythm/blob/codex/colony-integration-plan/docs/ai/plans/2026-09-18-electron-colony.md)

Milestone: Colony M4 — Installed acceptance and opt-in rollout

## Dependencies

#1531, #1533, #1535

## Likely files

- Proposed apps/electron/test/colony-installed/ native smoke harness
- docs/testing/manual-smoke.md
- docs/ai/contracts/colony-installed.json and run evidence
- Existing session-opening native test helpers

## Requirements

- Download the exact release-candidate archives, verify hashes and install into clean disposable test accounts on Apple Silicon and native Intel hardware/runner. Remove development checkout/PATH dependencies.
- Exercise supported real Keychain/sign-in behavior separately from synthetic credential fixtures. Keep all fixture/session content out of committed public evidence.
- Drive actual UI/menu input and assert visible exact-task identity, source-store preservation and owned-process behavior; include upgrades and rollback with existing local preferences.

## Acceptance criteria

- [ ] **COL-11-AC1:** Both installed signed architectures pass first launch disabled, enablement/source choice, empty/populated inventories, list/scene selection, archive/restore, Finder/copy and supported exact task/parent navigation.
- [ ] **COL-11-AC2:** Switching Rhythm tasks preserves authentication and the existing main/API/engine processes; missing external apps and unsupported task refs report accurately without launching another task.
- [ ] **COL-11-AC3:** Quit/relaunch, scanner crash/retry, disable/re-enable, account switch, offline use and low-GPU fallback preserve correct data boundaries and leave no orphan scanner.
- [ ] **COL-11-AC4:** An upgrade from the preceding compatible build and rollback/backup restoration retain local preferences and do not alter harness records. Evidence names artifact SHA, app version, OS, CPU and any unpassed case; no required case is silently skipped.

## Required tests / evaluation

- Run native installed-artifact behavioral tests, screenshots and synthetic-store before/after comparisons on both architectures.
- Run real signing/Keychain checks in disposable accounts; mock Keychain and Rosetta alone do not qualify the Intel/real-credential gates.
- Record failure postmortem and repair only demonstrated defects before repeating affected acceptance paths.

## Safety and scope

All-user opt-in; macOS Apple Silicon and Intel. Discovery is read-only; Colony writes only its own profile-scoped preferences/cache. No cloud upload of harness data, provider-secret changes, automatic agent turns, source deletions, or takeover/restart of live API/engine services. Use the canonical isolated sandbox for any needed backend smoke. New-session/terminal-resume actions and Flutter retirement are outside this plan. Work on a feature branch, capture required evidence and open a draft PR; human merge/release remains separate.
