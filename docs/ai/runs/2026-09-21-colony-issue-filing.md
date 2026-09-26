---
date: 2026-09-21
repo: Rhythm
branch: codex/colony-integration-plan
pr: 1539
issues: [1525, 1526, 1527, 1530, 1534, 1535]
status: planning-only
tags: [run, rhythm]
---

# Colony plan realigned to the Hermes Desktop shape

Requested: file the Colony integration plan as GitHub issues with a milestone, and first revise the
plan so it follows the approach used to add the Hermes tab, because that one went smoothly.

Outcome: the milestones and issues already existed from the 2026-09-18 planning run
(milestones 105–108, epic #1525, issues #1526–#1537). Nothing new was filed. The plan was revised to
the Hermes shape and the affected issues were updated **in place**, so no duplicates were created.

## Files

- `docs/ai/plans/2026-09-18-electron-colony.md` — new "Adoption shape: follow the Hermes Desktop
  precedent" section; rewritten architecture list, packaging section and milestone/issue sequence;
  Electron-major and notices passages corrected.
- `docs/ai/plans/2026-09-18-electron-colony-tracking.md` — dependency-ordered issue table.
- `docs/ai/generated-issues/colony/` — `col-01.md`, `col-02.md`, `col-05.md`, `col-09.md`,
  `col-10.md`, `epic.md`, `manifest.json`.

## Checks

- Hermes reference read: run record `2026-09-19-hermes-desktop-replacement.md`, commit `6ed3ba03`,
  `hermes-desktop-artifact.mjs`, `hermes-desktop-config.mjs`, `package-mac.mjs:stageHermesDesktopArtifact`
  and the `electron_release.yml` producer steps.
- Searched existing issues before writing; found the full Colony set already filed. No duplicates.
- Created the `colony` label and applied it to #1525 and #1526–#1537 (13 issues).
- Updated bodies: #1526, #1527, #1530, #1534, #1535. Updated titles: #1526, #1527, #1534, #1535.
  Updated epic checklist and ordering: #1525.
- Planning only. No product code written, no implementation dispatched, nothing merged, PR #1539
  left open. The running app, api_server (4001) and engine (4096) were not touched.

## Notes

Four substantive divergences from the Hermes approach were found and corrected:

1. **Vendoring.** COL-01 was going to copy Bot Crossing source into `apps/colony/` with
   `UPSTREAM.json`, import tooling and a manual update procedure. Hermes deliberately kept upstream
   upstream and reduced Rhythm's record of it to one constant. COL-01 now pins
   `PINNED_COLONY_SOURCE_COMMIT` and adds a `build:rhythm-embedded` script upstream.
2. **No integrity/refusal contract.** The draft had extensive renderer-security prose but nothing
   equivalent to Hermes refusing a dirty, mismatched, corrupt or over-complete artifact with no
   fallback. COL-02 now specifies `colony-desktop-artifact.mjs`, its full refusal list and its own
   test file, plus the `refreshColonyArtifactIntegrity` re-seal helper COL-09 needs.
3. **Ordering.** Packaging was COL-09 of 12, behind all UI work, with COL-05 explicitly developing
   "against the bounded fixture contract". That is the inverse of what made Hermes smooth. COL-09
   and COL-10 now depend only on M1 and run in parallel with M2; COL-05 depends on COL-09 so the tab
   is built against the payload that actually ships.
4. **Dev/prod seam.** "Development fallback is allowed only in explicit dev mode" was replaced by a
   single `RHYTHM_COLONY_ARTIFACT_DIR` pointing at a real built artifact under identical validation.
   A second loading mode is how a package works in dev and fails installed.

Two smaller corrections: the Electron major is now a pinned build input asserted as `electronMajor`
on every load, rather than something "the first executable slice must prove"; and third-party
notices move inside the sealed artifact so they cannot drift from the code they describe.

Four areas were left alone because Colony genuinely differs from Hermes: the owned long-lived
scanner over ~15,500 sessions, reading other tools' harness stores read-only, replacing the upstream
chrome with Rhythm-native controls, and the 3D/WebGL surface's motion, quality and GPU-failure
behavior. The rest of the plan — acceptance criteria quality, evidence discipline, scope boundaries
— was already well-shaped and was not changed.
