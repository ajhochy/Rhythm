---
date: 2026-09-27
repo: Rhythm
branch: codex/finish-1576-1582
pr: null
issues: [1582]
status: partial
tags: [retro, adherence]
smoke_result: fail
verification_claimed: false
divergence: false
overall_score: partial
---

# #1582 UI review retrospective

## Finding

B2 was falsely green (**C2 wrong contract**): the test dispatched a synthetic `wheel` event instead of Playwright's native wheel input, and its content/anchor fixtures did not cover the visible states needed to prove real unpinning and anchoring behavior. The independent UI review correctly blocked the run before verification PASS.

## Criteria

| Criterion | Contract | Observed | Category |
|---|---|---|---|
| B1 production hydration | pass | not contradicted by review | none |
| B2 scroll contracts | pass | native wheel and complete content/anchor behavior not proven | C2 |
| B3 interruption | pass | not contradicted by review | none |
| B4 sandbox qualification | pass | not contradicted by review | none |
| B5 packaged/static gates | pass | not contradicted by review | none |
| B6 accessibility | pass | not contradicted by review | none |

## Chain adherence

- `expected_chain`: intake-change-classification → context-pack → plan-spec-optional → acceptance-contract → implement-slice → conditional-quality-reviews → verification-gate → project-state-update → draft-pr → manual-smoke → manual-merge
- `observed_chain`: acceptance-contract → implement-slice → local checks → conditional UI review failure → workflow-retrospective
- `skipped_skills`: none established; verification and downstream stages were correctly blocked.

## Issues

1. **C2 · smoke-test-writer/verification-gate UI evidence** — synthetic wheel dispatch bypassed the native interaction path; detected by UI review and `dispatchEvent('wheel')` in E52A-c6.
2. **C2 · acceptance-contract** — B2's fixtures omitted enough content/anchor states to falsify broken visible behavior while remaining green; detected by UI review against the claimed scroll contract.

## Durable action

Add one narrow UI-evidence rule: interaction-sensitive wheel/pointer/scroll checks must use Playwright native input and assert the visible outcome across the content/anchor states named by the contract. No product, image, provider, or broader workflow change.
