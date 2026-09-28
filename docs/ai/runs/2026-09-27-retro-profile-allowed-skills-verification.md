---
date: 2026-09-27
repo: Rhythm
status: partial
tags: [retro, adherence, Rhythm]
---

# Allowed-skills verification retrospective

- `smoke_result`: not run; this was an evidence review, not a product smoke
- `verification_claimed`: focused checks were green and c7/c9/c10/c12 were reported as directly evidenced
- `divergence`: false; no smoke failed, but review found a verification-evidence mismatch
- `overall_score`: partial

## Criterion comparison

| Criterion | Contract status | Observed status | Category |
|---|---|---|---|
| c7 | Claimed directly evidenced | Green check did not directly assert the full clause | W adherence |
| c9 | Claimed directly evidenced | Green check did not directly assert the full clause | W adherence |
| c10 | Claimed directly evidenced | Green check did not directly assert the full clause | W adherence |
| c12 | Claimed directly evidenced | Green check did not directly assert the full clause | W adherence |

## Workflow comparison

- `expected_chain`: verification review preserves clause-to-assertion fidelity and distinguishes direct evidence from inference
- `observed_chain`: focused checks passed, but the gate overclaimed direct evidence for c7/c9/c10/c12; this is the second allowed-skills review/gate miss
- `skipped_skills`: none established

## Issues

- category: W adherence
  affected skill: verification gate
  description: The report promoted partial or inferred coverage to direct evidence for four criteria despite the existing fidelity rule.
  detected_by: second allowed-skills evidence review

## Action

No skill change. Existing skills already require clause-to-assertion fidelity; the smallest correction is to retain this run-level evidence and require the next gate report to label unsupported clauses as gaps rather than direct evidence.
