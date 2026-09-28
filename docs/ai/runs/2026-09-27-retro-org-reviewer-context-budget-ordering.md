---
date: 2026-09-27
repo: Rhythm
branch: codex/org-reviewer-context-budget
pr: null
issues: [org-reviewer-context-budget]
status: verification-failed
tags: [retro, adherence]
smoke_result: not-run
verification_claimed: fail
divergence: false
overall_score: partial
---

# Retrospective — org reviewer context-budget ordering

## Finding

Implementation and checks passed, but verification correctly rejected the result:
the explicit priority was lost when the acceptance text was converted into the
contract. Static collections/catalogs had to be bounded before allocating bytes
to transcript/session data. Criterion c3 grouped all of them as undifferentiated
optional data, and the tests therefore could pass without proving that order.

Category: **C2 wrong contract** (with a **W adherence** symptom at contract
translation). A green contract exercised the wrong priority rule; detection was
the verifier's comparison with the original acceptance ordering.

## Per-criterion comparison

| Criterion | Contract | Observed | Category |
|---|---|---|---|
| c1 | pass | pass; limits unchanged | — |
| c2 | pass | pass; overview reads are bounded | — |
| c3 | pass | **fail**; contract/test omitted the required catalog-before-transcript/session allocation order | C2 wrong contract |
| c4 | pass | partial; deterministic collection bounds exist, but their required priority over transcript/session allocation is unproved | C2 wrong contract |
| c5 | pass | pass; completeness-required target fields remain exact | — |
| c6 | pass | pass; transcript pressure remains bounded and explicit | — |
| c7 | pass | pass; target-specific reads and hashes are deterministic | — |
| c8 | pass | partial; regressions cover pressure and size, not the explicit cross-collection allocation order | C2 wrong contract |
| c9 | pass | pass; live signed API/MCP path succeeded within the recorded fixture limit | — |
| c10 | pass | pass; required commands/results were recorded | — |

## Workflow adherence

- **Expected chain:** intake/change classification → context pack → optional plan →
  acceptance contract → implement slice → conditional backend/live review →
  verification gate → project-state update → draft PR → manual smoke → manual merge.
- **Observed chain:** intake/context → acceptance contract → implementation →
  focused unit/build/live evidence → verification gate **FAIL** on acceptance
  ordering.
- **Skipped skills/stages:** none established before the failure. Project-state,
  draft PR, manual smoke, and merge are correctly blocked downstream.

## Smallest correction

No Rhythm skill was changed. `verification-gate` already requires every acceptance
clause to map to a direct binding assertion; adding a task-specific ordering rule
would duplicate existing policy and add recurring token cost. The next repair
should amend c3/c4/c8 and add one focused regression that fails if any
transcript/session byte is admitted before the bounded static catalogs are
allocated, then rerun verification. Product code was not edited by this retro.
