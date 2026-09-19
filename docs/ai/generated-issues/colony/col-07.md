## Goal

Give each desktop profile explicit control of local scanning and preserve Colony state safely across restarts, imports and upgrades.

Parent: #1525

Plan: [Colony in Rhythm Electron](https://github.com/ajhochy/Rhythm/blob/codex/colony-integration-plan/docs/ai/plans/2026-09-18-electron-colony.md)

Milestone: Colony M2 — Rhythm-native UI and menus

## Dependencies

#1528, #1530

## Likely files

- apps/web/src/pages/settings/ and Colony enablement/import UI
- Proposed apps/electron/src/colony-preferences.mjs
- Adopted state persistence/merge and identity-cache modules
- Profile-scoped app userData and proposed versioned migration tests

## Requirements

- Default off for every new account/profile. Explain local source scanning and allow source selection before any harness read. Do not sync source paths/history/settings to the hosted API.
- Store Colony preferences and identity cache outside the signed bundle under a stable local profile key. Retain IDs, viewed/archive timestamps, grouping overrides and three-way conflict semantics.
- Support explicit standalone-state file selection, preview, backup and atomic merge. Never move, delete or rewrite the original standalone state or any harness file. Handle large archives through the bounded state-transfer contract.
- Sign-out/account switch revokes channels, stops scanning and clears visible/cache data from memory. Disable preserves local state; later opt-in restores it.

## Acceptance criteria

- [ ] **COL-07-AC1:** On first launch and after account switch, Colony is disabled and performs zero harness reads until that profile enables it; disabling stops the owned scanner without modifying source records.
- [ ] **COL-07-AC2:** After viewing/archiving/grouping tasks and restarting, exact preferences and IDs are restored. Concurrent stale saves merge or return an explicit conflict without silently dropping archives.
- [ ] **COL-07-AC3:** Importing a synthetic state with at least 7,000 archived entries shows a count preview, merges once after user action, preserves unrelated current state and leaves the source byte-for-byte unchanged. Repeating import is idempotent.
- [ ] **COL-07-AC4:** Corrupt, oversized, interrupted or unsupported-version imports leave the last valid state intact and explain recovery. A migration backup restores the documented previous compatible version.

## Required tests / evaluation

- End-to-end settings/enable/disable/account-switch and restart tests with fake profiles.
- Filesystem before/after evidence for source preservation, large-state chunking, atomic failure, concurrent saves and downgrade/backup restoration.

## Safety and scope

All-user opt-in; macOS Apple Silicon and Intel. Discovery is read-only; Colony writes only its own profile-scoped preferences/cache. No cloud upload of harness data, provider-secret changes, automatic agent turns, source deletions, or takeover/restart of live API/engine services. Use the canonical isolated sandbox for any needed backend smoke. New-session/terminal-resume actions and Flutter retirement are outside this plan. Work on a feature branch, capture required evidence and open a draft PR; human merge/release remains separate.
