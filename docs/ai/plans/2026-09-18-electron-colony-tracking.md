# Colony GitHub tracking

Parent epic: [#1525](https://github.com/ajhochy/Rhythm/issues/1525)

[Full plan](2026-09-18-electron-colony.md) · [documentation draft #1539](https://github.com/ajhochy/Rhythm/pull/1539)

Revised 2026-09-21: adoption approach and slice ordering realigned to the Hermes Desktop precedent.
The existing milestones and issues #1525–#1537 were updated in place; no duplicate issues were filed.

## Milestones

- [Colony M1 — Foundation and local runtime](https://github.com/ajhochy/Rhythm/milestone/105)
- [Colony M2 — Rhythm-native UI and menus](https://github.com/ajhochy/Rhythm/milestone/106)
- [Colony M3 — Packaged Apple Silicon and Intel builds](https://github.com/ajhochy/Rhythm/milestone/107)
- [Colony M4 — Installed acceptance and opt-in rollout](https://github.com/ajhochy/Rhythm/milestone/108)

## Issues in dependency order

M3 packaging now depends only on M1, so the sealed-artifact foundation is staged into a real package
while M2 builds the interface on top of it. In the original draft COL-09 sat behind COL-07 and
COL-08, deferring every packaging discovery until after the entire UI was written.

| Order | Issue | Milestone | Depends on |
| --- | --- | --- | --- |
| 1 | [#1526 — [COL-01] Pin upstream Colony source and emit a sealed embedded artifact](https://github.com/ajhochy/Rhythm/issues/1526) | M1 | None in plan |
| 2 | [#1527 — [COL-02] Verify the Colony artifact and add the isolated embedded bridge](https://github.com/ajhochy/Rhythm/issues/1527) | M1 | #1526 |
| 3 | [#1528 — [COL-03] Manage the owned local scanner and source discovery](https://github.com/ajhochy/Rhythm/issues/1528) | M1 | #1527 |
| 4 | [#1529 — [COL-04] Design the Rhythm-native Colony workspace and menu system](https://github.com/ajhochy/Rhythm/issues/1529) | M2 | None in plan |
| 5 | [#1534 — [COL-09] Stage the sealed Colony artifact in the Mac package](https://github.com/ajhochy/Rhythm/issues/1534) | M3 | #1527, #1528 |
| 6 | [#1535 — [COL-10] Make release CI the Colony artifact producer](https://github.com/ajhochy/Rhythm/issues/1535) | M3 | #1534 |
| 7 | [#1530 — [COL-05] Build the native Colony tab, task rail and inspector](https://github.com/ajhochy/Rhythm/issues/1530) | M2 | #1527, #1529, #1534 |
| 8 | [#1531 — [COL-06] Connect exact task actions and Rhythm-native menus](https://github.com/ajhochy/Rhythm/issues/1531) | M2 | #1528, #1530 |
| 9 | [#1532 — [COL-07] Add local opt-in, persistent preferences and reversible import](https://github.com/ajhochy/Rhythm/issues/1532) | M2 | #1528, #1530 |
| 10 | [#1533 — [COL-08] Complete resource behavior, accessibility and failure recovery](https://github.com/ajhochy/Rhythm/issues/1533) | M2 | #1530, #1531, #1532 |
| 11 | [#1536 — [COL-11] Qualify installed signed Colony on Apple Silicon and Intel](https://github.com/ajhochy/Rhythm/issues/1536) | M4 | #1531, #1533, #1535 |
| 12 | [#1537 — [COL-12] Document and gate the all-user opt-in Colony release](https://github.com/ajhochy/Rhythm/issues/1537) | M4 | #1536 |

All issues carry the `colony` label. Dependency edges remain acyclic.

COL-06 also depends on review of [receiver draft PR #1538](https://github.com/ajhochy/Rhythm/pull/1538); see its scoped evidence and broad-suite failure notes.
