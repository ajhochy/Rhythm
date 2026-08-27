---
date: 2026-08-26
repo: Rhythm
branch: fix/bridge-stream-reliability
pr: null
issues: [1458]
status: complete
tags: [retro, adherence]
smoke_result: not_run
verification_claimed: fail
divergence: false
overall_score: partial
---

# Retrospective — verification metadata lifecycle drift

## Result

The latest gate stopped on pre-execution `UNVERIFIED` metadata, skipped the referenced live suite, and misclassified absent evidence as a product failure. `UNVERIFIED` was correct input state: execute first, then write pass/fail evidence and assess final status hygiene. Only a missing or malformed acceptance contract should block execution.

## Criteria

| Criterion | Contract before gate | Observed | Category |
|---|---|---|---|
| `issue-1458-c1` bypass session completes gated tools with global stream down | `UNVERIFIED`, live test named | Gate did not execute test; no product result | W adherence |
| `issue-1458-c2` engine permission queue remains empty | `UNVERIFIED`, live test named | Gate did not execute test; no product result | W adherence |
| `issue-1458-c3` external-directory coverage | `pass`, unit test named | Existing evidence remained green | none |
| `issue-1458-c4` bypass does not depend on global listener | `pass`, unit test named | Existing evidence remained green | none |

No repository defect was established by the skipped live gate.

## Chain

- **Expected:** intake-change-classification → context-pack → acceptance-contract → implement-slice → conditional-quality-reviews → verification-gate (launch harness, execute evidence, reconcile statuses) → project-state-update → draft-pr → manual-smoke → manual-merge.
- **Observed:** implementation reached verification-gate; the gate treated pre-test metadata as terminal, skipped harness/test execution, and returned a product-state failure.
- **Skipped skills/stages:** live portion of `verification-gate`; downstream stages correctly did not run after the non-pass.

## Issues

| Category | Affected skill/stage | Symptom and detection |
|---|---|---|
| W adherence | verification-gate | `UNVERIFIED` was evaluated before its named test ran, inverting the contract lifecycle. |
| P process | workflow-orchestrator | Pre-verification reconciliation also treated expected pre-run `UNVERIFIED` as a reason to divert before evidence execution. |
| C4 environment/harness | verification dispatch | Commands used a relative API path without first anchoring execution to the dispatched worktree/repo root. |
| C4 environment/harness | verification dispatch | Tests waited for a replacement engine that the launch sequence had not started. |
| C4 environment/harness | verification dispatch | Sandbox startup lacked the four explicit sanitized-fixture variables required by `docs/ai/testing-guide.md`. |
| P process | verification dispatch | Provider/model assumptions were repeated instead of treating the documented harness command and observable readiness as authoritative. |

## Root-cause split

- **Repository defects:** none proven by this gate; behavior never executed.
- **Gate defect:** status hygiene ran before evidence collection.
- **Dispatch/prompt defect:** worktree command roots, launch ownership, and literal fixture variables were not made explicit.
- **Harness operation defect:** replacement-engine readiness was awaited without a corresponding launch; provider/model behavior was assumed rather than observed.

## Durable correction

Make verification explicitly three-phase: validate contract shape, execute every referenced required test from the exact dispatched worktree with the documented launch environment, then reconcile statuses. Pre-run `UNVERIFIED` is expected and never blocks its test. Add a backend-live preflight for absolute worktree command paths and all four sanitized-fixture variables before launch.
