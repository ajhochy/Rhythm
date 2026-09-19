# Colony GitHub tracking

Parent epic: [#1525](https://github.com/ajhochy/Rhythm/issues/1525)

[Full plan](2026-09-18-electron-colony.md) · [documentation draft #1539](https://github.com/ajhochy/Rhythm/pull/1539)

## Milestones

- [Colony M1 — Foundation and local runtime](https://github.com/ajhochy/Rhythm/milestone/105)
- [Colony M2 — Rhythm-native UI and menus](https://github.com/ajhochy/Rhythm/milestone/106)
- [Colony M3 — Packaged Apple Silicon and Intel builds](https://github.com/ajhochy/Rhythm/milestone/107)
- [Colony M4 — Installed acceptance and opt-in rollout](https://github.com/ajhochy/Rhythm/milestone/108)

## Issues

| Issue | Milestone | Depends on |
| --- | --- | --- |
| [#1526 — [COL-01] Adopt pinned Bot Crossing source and asset provenance](https://github.com/ajhochy/Rhythm/issues/1526) | M1 | None in plan |
| [#1527 — [COL-02] Add embedded service and scene contracts with an isolated bridge](https://github.com/ajhochy/Rhythm/issues/1527) | M1 | #1526 |
| [#1528 — [COL-03] Manage the owned local scanner and source discovery](https://github.com/ajhochy/Rhythm/issues/1528) | M1 | #1527 |
| [#1529 — [COL-04] Design the Rhythm-native Colony workspace and menu system](https://github.com/ajhochy/Rhythm/issues/1529) | M2 | None in plan |
| [#1530 — [COL-05] Build the native Colony tab, task rail and inspector](https://github.com/ajhochy/Rhythm/issues/1530) | M2 | #1527, #1529 |
| [#1531 — [COL-06] Connect exact task actions and Rhythm-native menus](https://github.com/ajhochy/Rhythm/issues/1531) | M2 | #1528, #1530 |
| [#1532 — [COL-07] Add local opt-in, persistent preferences and reversible import](https://github.com/ajhochy/Rhythm/issues/1532) | M2 | #1528, #1530 |
| [#1533 — [COL-08] Complete resource behavior, accessibility and failure recovery](https://github.com/ajhochy/Rhythm/issues/1533) | M2 | #1530, #1531, #1532 |
| [#1534 — [COL-09] Bundle a self-contained Colony payload in the Mac app](https://github.com/ajhochy/Rhythm/issues/1534) | M3 | #1528, #1532, #1533 |
| [#1535 — [COL-10] Extend arm64/x64 signing and release CI for Colony](https://github.com/ajhochy/Rhythm/issues/1535) | M3 | #1534 |
| [#1536 — [COL-11] Qualify installed signed Colony on Apple Silicon and Intel](https://github.com/ajhochy/Rhythm/issues/1536) | M4 | #1531, #1533, #1535 |
| [#1537 — [COL-12] Document and gate the all-user opt-in Colony release](https://github.com/ajhochy/Rhythm/issues/1537) | M4 | #1536 |

All remote bodies and milestone assignments were read back and matched the generated files. No implementation issues were closed and no implementation was dispatched.

COL-06 also depends on review of [receiver draft PR #1538](https://github.com/ajhochy/Rhythm/pull/1538); see its scoped evidence and broad-suite failure notes.
