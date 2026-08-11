---
date: 2026-08-08
repo: Rhythm
branch: feat/artifact-viewer
pr: null
issues: [AV-03]
status: partial
tags: [retro, adherence]
smoke_result: "product and sandbox live behavior green; evidence-quality review failed"
verification_claimed: "green run note / PASS-equivalent"
divergence: false
---

# AV-03 evidence-quality retrospective

## Per-criterion comparison

| Criterion | Contract | Observed | Category |
|---|---|---|---|
| c1 tool registration | pass | Product behavior green; report treated registrar-call delta as final tool-count delta. | P |
| c2–c4 transport/schema/errors | pass | Green; no evidence defect reported. | P |
| c5 security graph | pass | Positive classification lacked a fail-closed negative. | P |
| c6 fixture | pass | Green; no evidence defect reported. | P |
| c7 focused evidence | pass | Contract `test_command` still named obsolete HTTP-only harness rather than the passing focused suite. | P |
| c8 live E2E | pass | Product behavior green; revision proof asserted relative `+1`, not required `1 → 2`. | P |

## Chain

- Expected: intake-change-classification → context-pack → plan-spec-optional → acceptance-contract → implement-slice → conditional-quality-reviews → verification-gate → project-state-update → draft-pr → manual-smoke → manual-merge.
- Observed: acceptance contract, implementation, sandbox live E2E, and verification evidence were recorded; no skipped skill is established by the supplied evidence.
- Skipped skills: none established.

## Issues

1. `P` / `acceptance-contract`: the canonical `test_command` drifted to an obsolete HTTP-only harness; detected by comparison with the later passing focused suite.
2. `P` / `verification-gate`: registration evidence conflated an invocation delta with the resulting registered-tool count; detected during evidence review.
3. `P` / `verification-gate`: a required concrete revision transition was evidenced only as a relative increment; detected during live-test assertion review.
4. `P` / `verification-gate`: trust-boundary positives lacked a corresponding denial assertion; detected against the security evidence requirement.

## Outcome

Overall score: **partial**. Product and live behavior are green; acceptance/verification artifacts were not precise enough to support the claimed evidence quality. A small acceptance-contract clarification will require the canonical command to be the maintained harness and concrete externally specified values to be asserted exactly. The existing security reference already requires a negative trust-boundary test; no broader policy change is needed.
