---
date: 2026-08-08
repo: Rhythm
branch: feat/artifact-viewer
pr: null
issues: [AV-02]
status: retrospective_complete
tags: [retro, adherence, api_server, AV-02]
smoke_result: not_run
verification_claimed: pass
divergence: true
overall_score: partial
---

## Scope

Separate retrospective artifact for the final AV-02 repair cycle. It does not
edit product code, the AV-02 contract, or the active AV-02 run note.

## Per-criterion comparison

| Criterion | Contract status | Observed status | Category |
| --- | --- | --- | --- |
| av02-c1 | pass | No route-surface defect reported. | P — aligned. |
| av02-c2 | pass | No public-shape defect reported. | P — aligned. |
| av02-c3 | pass | `publishBundle()` exposes its destination before files are written; a successful PUT can publish an empty bundle. | C2 wrong contract. |
| av02-c4 | pass | First-pass security defects were repaired and independently proven fixed. | P — aligned after repair. |
| av02-c5 | pass | PUT 200 advances the DB pointer before bundle contents are readable; the next render is 500. | C2 wrong contract. |
| av02-c6 | pass | First-pass rendering/security defects were repaired and independently proven fixed. | P — aligned after repair. |
| av02-c7 | pass | No capability defect reported. | P — aligned. |
| av02-c8 | pass | Traversal test reaches oversized-state validation first, so it does not prove traversal handling. | C2 wrong contract. |
| av02-c9 | pass | No scope defect reported in this retrospective. | P — aligned. |

## Chain comparison

- **Expected chain:** intake/change classification → context pack → acceptance contract → implement slice → conditional reviews → verification gate → project-state update → draft PR → manual smoke.
- **Observed chain:** acceptance tests and first verification found three security defects; repair and independent proof completed. Second verification then found the missing update→render observable assertion and the ordered-validation test-input flaw. Downstream stages did not run.
- **Skipped skills:** no required stage is evidenced as skipped. The drift is weak contract-test design at the acceptance-contract/verification boundary, not failure-triage work.

## Issues

1. **C2 wrong contract — acceptance-contract / verification-gate:** bundle-write tests treated PUT 200 and pointer advancement as success without consuming the newly published bundle through render; detected by the second verification's update→render failure.
2. **C2 wrong contract — acceptance-contract:** the traversal case also violated the decoded-size limit, so validation order short-circuited before the traversal assertion; detected by the focused traversal review.

## Outcome

The contract must prove the observable post-mutation read path and isolate each ordered validator with inputs valid for every non-target guard. A small upstream acceptance-contract wording correction is justified; failure-triage remains unchanged.
