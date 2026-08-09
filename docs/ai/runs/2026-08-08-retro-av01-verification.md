---
date: 2026-08-08
repo: Rhythm
branch: feat/artifact-viewer
pr: null
issues: [AV-01]
status: retrospective_complete
tags: [retro, adherence, api_server, AV-01]
smoke_result: not_run
verification_claimed: fail
divergence: false
overall_score: partial
---

## Scope

This is a separate retrospective artifact. It does not amend the concurrent
AV-01 run note or acceptance contract owned by failure-triage.

## Per-criterion comparison

| Criterion | Contract status at overall verification | Observed status | Category |
| --- | --- | --- | --- |
| av-01-c1 | pass | Focused parity/idempotency evidence passed. | P — aligned; no criterion defect observed. |
| av-01-c2 | pass | Focused parity/idempotency evidence passed. | P — aligned; no criterion defect observed. |
| av-01-c3 | pass | Focused parity/idempotency evidence passed. | P — aligned; no criterion defect observed. |
| av-01-c4 | pass | Focused storage-config evidence passed. | P — aligned; no criterion defect observed. |
| av-01-c5 | partial with real-Postgres execution in `not_tested` | AJ-approved ephemeral Postgres bootstrap-twice evidence passed. | W adherence — the contract was not reconciled to the newly captured evidence before the overall gate. |

## Chain comparison

- **Expected chain:** intake/change classification → context pack → acceptance contract → implement slice → conditional reviews → verification gate → project-state update → draft PR → manual smoke.
- **Observed chain:** acceptance implementation and focused verification failed once for weak parity/deployment/live-Postgres evidence; failure-triage repaired those items; attempt two passed focused AV-01 gates with approved ephemeral Postgres; overall verification then failed on stale contract state and a contaminated repo-wide suite. Project-state update, draft PR, and manual smoke correctly did not run.
- **Skipped skills:** no required stage is evidenced as skipped. The stale status handoff is workflow drift within the acceptance-contract/verification boundary.

## Issues

1. **W adherence — verification-gate / acceptance-contract handoff:** New live-Postgres evidence changed c5 from partial/not-tested to pass, but the contract remained stale when the overall gate evaluated it. Detected from the attempt-two result against the still-partial contract status.
2. **C4 environment/harness — repo-wide test invocation:** `npm test` inherited `AGENT_LOCAL` and `MEMORY_VAULT`, activating contaminated local state; two sanitized OAuth failures also depend on parallel/order execution and pass in isolation. Detected from the full-suite-only failures after focused AV-01 gates passed.

## Recommendations

1. Before invoking a repo-wide suite after new evidence, reconcile each affected contract criterion and its `not_tested`/blocked entries in the same handoff; verification must read the resulting current contract, not a prior status.
2. Run a broad suite from a fresh shell with test-activating local environment variables explicitly removed unless the command documents them. For suites with known shared state, use the repository's documented serialized mode and report isolated reruns separately from the clean broad-suite result.
3. Treat isolated-green, parallel/order-dependent OAuth failures as harness work, not AV-01 product regressions; keep their repair ownership separate from this slice.

## Outcome

No product code, AV-01 contract, or concurrent AV-01 run note was edited here. A narrowly scoped verification-skill correction is justified to require an uncontaminated environment for broad suites; it is applied separately after this required postmortem.
