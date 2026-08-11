---
date: 2026-08-09
repo: Rhythm
branch: ui/desktop-mobile-session-polish
pr: 1337
issues: [1337]
status: fail
smoke_result: accepted_with_evidence_reconciliation_needed
verification_claimed: fail
divergence: false
overall_score: partial
tags: [run, retro, adherence, verification]
---

## Scope

Verification-gate correctly returned **FAIL** even though product checks were green: Flutter 1069 and mobile 53. This is documentation/status hygiene only; no product behavior failure or product-file change is asserted.

## Per-criterion comparison

| Contract | Contract status | Observed status | Category |
| --- | --- | --- | --- |
| `ui-dashboard-glance-layout.json` c1–c8 | `pass` | Focused Flutter geometry/overflow evidence is green. | P process |
| `ui-dashboard-glance-layout.json` c9 | `UNVERIFIED`, listed in `not_tested` | Process checks are recorded, but the contract status was not reconciled to the allowed not-tested/manual disposition before verification. | W adherence |
| `ui-desktop-agents-session-pane.json` c1–c9, c11–c21, c23–c43, c45–c50 | `pass` | Focused Agents geometry/accessibility evidence is green. | P process |
| `ui-desktop-agents-session-pane.json` c10, c22, c44, c51 | `UNVERIFIED`, listed in `not_tested` | c44 has AJ manual acceptance and geometry evidence, but no durable repo visual-artifact path; the remaining manual/process entries also remained unreconciled. | W adherence |
| `mobile-native-prompt-submit.json` c1–c3, c6 | `pass` | Focused regression, broader Jest, and AJ simulator/fake-gateway evidence are green. | P process |
| `mobile-native-prompt-submit.json` c4–c5 | `UNVERIFIED`, listed in `not_tested` | Run-note check evidence exists, but the contract still reports unresolved status. | W adherence |
| `ui-mobile-agents-session-list.json` c1–c8 and repair criteria | `pass` | Focused Jest, lint, and typecheck evidence are green. | P process |
| `ui-mobile-agents-session-list.json` c9 | `UNVERIFIED`, listed in `not_tested` | Diff-scope evidence was not reconciled to the allowed not-tested/manual disposition. | W adherence |

`not_tested` is an allowed mapping only when the corresponding criterion no longer presents as unresolved. Retaining `UNVERIFIED` made the PR-readiness invariant false despite the green product checks.

## Chain comparison

- **expected_chain:** intake-change-classification → context-pack → acceptance-contract → implement-slice → conditional-quality-reviews → verification-gate → project-state-update → draft-pr → manual-smoke → manual-merge.
- **observed_chain:** acceptance contracts, implementation, focused checks, and iterative AJ smoke occurred; verification-gate then found unreconciled contract/run-note evidence. Final reconciliation before verification did not occur.
- **skipped_skills:** none established from the supplied facts. The missed step was an orchestrator-owned evidence-reconciliation handoff, not a specialist dispatch.

## Issues

```yaml
issues:
  - category: W adherence
    affected_skill: workflow-orchestrator
    description: Verification was dispatched without a mechanical sweep of owned contracts for unresolved UNVERIFIED statuses that were also listed in not_tested.
    detected_by: verification-gate PR #1337 failure
  - category: W adherence
    affected_skill: workflow-orchestrator
    description: Specialist run notes still declared READY_FOR_VERIFICATION after later AJ evidence changed the final evidence state.
    detected_by: verification-gate PR #1337 failure
  - category: W adherence
    affected_skill: workflow-orchestrator
    description: Stale waiver/manual wording contradicted later evidence rather than being reconciled once before the final gate.
    detected_by: verification-gate PR #1337 failure
  - category: P process
    affected_skill: workflow-orchestrator
    description: AJ manual acceptance and geometry checks had no durable repository visual-artifact path because macOS Screen Recording permission blocked automated capture.
    detected_by: verification-gate PR #1337 failure and AJ smoke report
```

## Root cause and prevention

The workflow had evidence but no single final owner handoff to normalize evidence recorded after specialist notes. Treat late manual smoke as a state change: before verification dispatch, the orchestrator mechanically checks owned contracts for `UNVERIFIED`, run notes for `READY_FOR_VERIFICATION`, stale waiver/manual language, and a durable UI-artifact path; it routes one reconciliation update before the gate.

## Constraints

- Do not alter PR #1337 product files, existing specialist-owned contracts/run notes, `project-state.md`, git history, release state, or merge state in this retrospective.
- Screen Recording permission is an environment limitation (C4) only for automated capture; it does not waive recording an AJ-provided visual artifact path or explicitly documenting why no durable artifact exists.
