---
date: 2026-09-27
repo: Rhythm
branch: mega/2026-09-18-mobile-electron-hermes
pr: 1544
issues: [task-profile-allowed-skills-management]
status: partial
tags: [retro, adherence]
smoke_result: FAIL
verification_claimed: false
divergence: false
overall_score: partial
---

# Allowed-skills UI review retrospective

No image was inspected. This review used the contract, run note, test text, and relevant rendered markup only.

## Result

The independent UI review correctly stopped the run before verification PASS. The coding run's `pass` statuses overclaimed composite criteria c10, c12, and c14: their tests did not bind every clause to an assertion, and c12's axe-clean result did not catch duplicated `role="alert"` output for the same skill error.

## Per-criterion comparison

| Criterion | Contract | Observed | Category |
| --- | --- | --- | --- |
| c1-c9 | pass | Not challenged by this focused review. | none |
| c10 | pass | Dialog closure is asserted; async fencing, relevant-control disabling, and one mutation under repeated submit are not directly asserted. | C1 missing contract |
| c11 | pass | Not challenged by this focused review. | none |
| c12 | pass | The test checks axe, one 44px button, and dialog overflow only. It does not measure whole-page overflow at 720px; duplicated ARIA alerts remain in the rendered error path. | C1 missing contract; C2 wrong contract |
| c13 | pass | Not challenged by this focused review. | none |
| c14 | pass | The test proves no Edit button for one org row, not the full external-row read-only boundary (including mutation affordances/actions). | C1 missing contract |
| c15 | pass | Not challenged by this UI-focused review. | none |
| c16 | UNVERIFIED | Later UI review ran and failed on the findings above; the gate behaved correctly. | P process |

## Chain adherence

- **Expected chain:** intake/change classification → context pack → optional plan/spec → acceptance contract → implement slice → UI/accessibility review → verification gate → project-state update → draft PR → manual smoke → manual merge.
- **Observed from durable artifacts:** acceptance contract → implementation/local checks → independent UI review failure. The run note remained `ready-for-verification`; no final verification PASS was claimed.
- **Skipped skills:** none established. Verification and downstream stages were not completed after the review failure, which is correct.

## Issues

1. **C1 · acceptance-contract execution:** c10 was marked pass from a test that asserts only profile-switch dialog closure; its other clauses have no direct assertions.
2. **C1/C2 · acceptance-contract execution:** c12 substitutes dialog containment and axe output for whole-page 720px containment, while duplicated alert regions show the accessibility claim is not fully proved.
3. **C1 · acceptance-contract execution:** c14 infers external read-only behavior from absence of one Edit button rather than asserting the complete external row has no mutation path.
4. **W adherence · coding run:** composite criteria were advanced to `pass` without a clause-to-assertion reconciliation.

## Improvement decision

Run-note retrospective only; no skill edit is warranted. Existing guidance already says:

- `acceptance-contract`: one criterion/one test ID, bind every criterion clause to the exact failing assertion, and reject a green test without a named regression/assertion.
- `verification-gate`: reconcile every clause to a direct binding assertion and fail weak-only coverage.
- UI verification reference: report whole-page responsive containment separately from changed-surface containment.

This was failure to apply current guidance, not a missing guidance clause. No `prompt-evolver` handoff is needed. The next run should return c10/c12/c14 to failing or `UNVERIFIED` until direct assertions cover the named gaps and the duplicated-alert behavior is repaired and re-reviewed.
