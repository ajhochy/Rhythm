---
date: 2026-08-14
repo: Rhythm
branch: codex/react-electron-live-suite
pr: null
issues: [electron-m1-slice-1]
status: complete
tags: [retro, adherence]
smoke_result: "automated baseline passed; required visual smoke artifact absent"
verification_claimed: "FAIL"
divergence: false
overall_score: partial
---

# Slice 1 evidence-acceptance retrospective

## Result

The product baseline was green (`build`, 238 Playwright passes with one
`RHYTHM_SWEEP` skip, and repaired dist smoke), but the evidence package was not.
Verification correctly failed rather than accepting two unsupported claims.

## Per-criterion comparison

| Criterion | Contract status | Observed status | Category |
|---|---|---|---|
| c1 new-tree scope | claimed satisfied | no contrary evidence | — |
| c2 filtered import | claimed satisfied | no contrary evidence | — |
| c3 provenance/digest | claimed satisfied | no contrary evidence | — |
| c4 fixture-only behavior | claimed satisfied | no contrary evidence | — |
| c5 complete suite/dist smoke | claimed satisfied | 238 passed, one screenshot sweep skipped; dist smoke passed, but its path-traversal guard was not exercised | C2 wrong contract |
| c6 network isolation | claimed satisfied with an explicit packet-capture gap | no contrary evidence | — |
| c7 scoped changes | claimed satisfied | no contrary evidence | — |
| c8 complete run evidence | claimed satisfied | overstated path safety and omitted a durable required visual artifact | W adherence |
| c9 structured handoff | claimed `READY_FOR_VERIFICATION` | handoff carried unsupported evidence completeness | W adherence |

The UI visual requirement was also absent from the slice contract despite the
workflow's `ui` classification requiring Playwright/screenshot evidence: **C1
missing contract**.

## Chain adherence

- **Expected chain:** intake/change classification → context pack → optional
  plan/spec → acceptance contract → implement slice → UI/accessibility review
  and Playwright visual evidence → pre-verification evidence reconciliation →
  verification gate → project-state/PR only after PASS.
- **Observed chain:** acceptance contract → import/repair → build and fixture
  suite with the screenshot sweep explicitly skipped → dist smoke →
  `READY_FOR_VERIFICATION` → verification gate FAIL.
- **Skipped/unproven stages:** durable UI visual evidence and the
  pre-verification evidence reconciliation that should have rejected both the
  unexercised path-safety claim and missing artifact. Intake/context/optional
  planning announcements were not available in the reviewed evidence.

## Issues

1. **C2 wrong contract — acceptance contract/dist smoke:** preserving a guard
   was treated as proof of path safety although no request exercised it;
   detected by verification-gate comparing the claim to runtime evidence.
2. **C1 missing contract / P process — orchestrator dispatch:** UI
   classification required durable visual evidence, but the dispatch allowed
   the only screenshot sweep to skip without replacement evidence; detected by
   the skipped test and absence of an artifact path.
3. **W adherence — pre-verification reconciliation:** the run advanced as
   `READY_FOR_VERIFICATION` while its own evidence showed the visual skip and
   only described an unexercised guard.

## Smallest durable correction

At pre-verification reconciliation, accept an evidence claim only when the run
note names an executed assertion/artifact for it. For this slice that means:

- describe the dist smoke narrowly unless a traversal attempt is actually run;
- for `ui`, require a durable repo screenshot/artifact path, or mark the visual
  criterion unverified/blocked—an allowed env-gated skip is not a waiver.

No Rhythm skill edit is warranted. The canonical orchestrator already states
both rules in `workflow-orchestrator/SKILL.md` under **Pre-verification evidence
reconciliation**; this was execution drift, not a missing policy. The next run
should stop at reconciliation before dispatching verification.

## Checks

No product code, services, tests, Git state, issues, branches, or PRs were
changed or run during this retrospective.
