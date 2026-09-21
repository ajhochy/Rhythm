## Goal

Deliver an opt-in Colony workspace for all Rhythm desktop users, packaged for Apple Silicon and Intel. Preserve the 3D colony and local multi-harness model while redesigning UI and menu items to match Rhythm Electron.

**This is a filed implementation plan, not implemented or release-qualified work.**

Plan: [Colony in Rhythm Electron](https://github.com/ajhochy/Rhythm/blob/codex/colony-integration-plan/docs/ai/plans/2026-09-18-electron-colony.md)

## Confirmed boundaries

- Default off; local profile/account opt-in. Local harness data stays on the Mac.
- Read-only discovery and local Colony preferences; no source-record deletion, automatic agent execution or API/engine takeover.
- Reuse existing Electron packaging, Node 22 and separate native arm64/x64 ZIPs.
- Dedicated design pass over typography, panels, inspectors, menus, action labels and keyboard behavior using Rhythm Tasks/Agents as the visual authority.
- Exact native task selection, state/import preservation, resource behavior, signed packaging, installed acceptance and rollback are separate gates.
- Existing Electron replacement/Flutter retirement gates remain independent. Planning/issue creation does not authorize implementation, merge or release publication.

## Milestones

- [Colony M1 — Foundation and local runtime](https://github.com/ajhochy/Rhythm/milestone/105): Adopt reviewed Bot Crossing source, prove the isolated embedded contracts and run a separately owned read-only scanner. Exit: real Electron uses local synthetic harness data without a localhost server, source writes, or changes to Rhythm API/engine ownership.
- [Colony M2 — Rhythm-native UI and menus](https://github.com/ajhochy/Rhythm/milestone/106): Design and implement the Colony workspace using Rhythm Electron conventions, exact task navigation, local opt-in/preferences, accessibility and bounded resource use. Exit: the native tab works through the real scanner; UI/menu review and failure-state tests pass.
- [Colony M3 — Packaged Apple Silicon and Intel builds](https://github.com/ajhochy/Rhythm/milestone/107): Extend existing Electron packaging and release CI with pinned Colony resources, bundled Node 22 capability checks, asset notices and architecture-specific signed/notarized ZIPs. Exit: both exact artifacts pass post-sign packaged smoke without a checkout or system Node.
- [Colony M4 — Installed acceptance and opt-in rollout](https://github.com/ajhochy/Rhythm/milestone/108): Qualify installed signed builds on Apple Silicon and Intel, including real task opening, account boundaries, upgrades and rollback. Exit: documented feature approval and all-user local opt-in rollout readiness; separate Electron host/cutover gates remain in force.

## Implementation checklist

- [ ] #1526 — [COL-01] Adopt pinned Bot Crossing source and asset provenance
- [ ] #1527 — [COL-02] Add embedded service and scene contracts with an isolated bridge
- [ ] #1528 — [COL-03] Manage the owned local scanner and source discovery
- [ ] #1529 — [COL-04] Design the Rhythm-native Colony workspace and menu system
- [ ] #1530 — [COL-05] Build the native Colony tab, task rail and inspector
- [ ] #1531 — [COL-06] Connect exact task actions and Rhythm-native menus
- [ ] #1532 — [COL-07] Add local opt-in, persistent preferences and reversible import
- [ ] #1533 — [COL-08] Complete resource behavior, accessibility and failure recovery
- [ ] #1534 — [COL-09] Bundle a self-contained Colony payload in the Mac app
- [ ] #1535 — [COL-10] Extend arm64/x64 signing and release CI for Colony
- [ ] #1536 — [COL-11] Qualify installed signed Colony on Apple Silicon and Intel
- [ ] #1537 — [COL-12] Document and gate the all-user opt-in Colony release

## Completion rule

All twelve implementation issues and their required evidence must be accepted. A green browser or source build does not qualify installed signed behavior. Both Mac architectures, native exact-task selection, profile isolation, upgrade/rollback and the opt-in rollout checklist must pass; a missing required gate remains open. Human review/merge/release is separate.

Planning document review: [draft PR #1539](https://github.com/ajhochy/Rhythm/pull/1539). This documentation PR does not complete the implementation issues.
