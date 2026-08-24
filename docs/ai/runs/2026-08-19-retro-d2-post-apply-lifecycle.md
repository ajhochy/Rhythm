---
date: 2026-08-19
repo: Rhythm
branch: agent-stack/si-d2-post-apply-lifecycle
pr: 1454
issues: [1431, 1432, 1433, 1434, 1435]
status: partial
tags: [retro, adherence]
---

# D2.1–D2.5 post-apply lifecycle retrospective

- `smoke_result`: pass — final sandbox E2E passed; 14/14 D2.5 criteria and required suites passed at `a033a73a`.
- `verification_claimed`: pass, after repair loops.
- `divergence`: false — no final PASS/manual-smoke contradiction; the failures were pre-PASS evidence, implementation, harness, and orchestration defects.
- `overall_score`: **partial** — the canonical chain ran, but implementation, evidence, documentation, and async-gating drift required repeated correction.

## Per-criterion comparison

| Criterion | Contract | Observed final | Category / earlier gap |
|---|---|---|---|
| c1 eligibility/reversible enrollment | pass | pass | C1: first D2.5 pass omitted eligible lanes; repaired with direct inclusion/exclusion evidence. |
| c2 bounded repeated sweep | pass | pass | C1: sweep/bound evidence was initially overclaimed; dedicated assertion added. |
| c3 repair succeeds | pass | pass | pass; persisted outcome directly asserted. |
| c4 exhaustion/revert/alert | pass | pass | pass after shared revert path and exact persisted assertions. |
| c5 expiry terminality | pass | pass | pass; terminal no-reopen behavior directly asserted. |
| c6 no recursive monitoring | pass | pass | C1: initially claimed without a binding assertion; direct evidence added. |
| c7 legacy measurement exclusion | pass | pass | C1: initially incomplete state coverage; monitoring ownership was asserted. |
| c8 SQLite/Postgres gate | pass | pass | C1: Postgres behavior initially claimed without direct evidence; gate asserted. |
| c9 per-event error isolation/redacted logs | pass | pass | C1: isolation was initially overclaimed; dedicated rejection evidence added. |
| c10 no sensitive persistence/logging | pass | pass | pass; secret sentinel absence directly asserted. |
| c11 real API/bootstrap/scheduler | pass | pass | C4: first invocation used the wrong directory; corrected sandbox run passed. |
| c12 post-commit enrollment isolation | pass | pass | C1: final loop omitted “measureProposal not called”; test-only gate added. |
| c13 readiness/overlap/limit/isolation | pass | pass | C1: composite claim initially exceeded direct assertions; dedicated tests added. |
| c14 both lifecycle measurement states | pass | pass | C1: both states were initially overclaimed; table-driven direct test added. |

## Chain adherence

- `expected_chain`: intake/change classification → context pack → plan/spec (as needed) → acceptance contract → implement slice → conditional reviews → verification gate → project-state update → draft PR → manual smoke → human merge.
- `observed_chain`: orchestrator → contracts/RED → D2.1–D2.5 implementation slices → repeated focused verification/repair → full verification + sandbox E2E → pushed draft-PR update; retrospective requested before merge.
- `skipped_skills`: none confirmed. The defect was ordering: D2.4 was committed before the pending verifier returned explicit `READY_FOR_COMMIT`; project-state is now stale after the final D2.5 commit.

## Issues, root causes, detection gaps, safeguards

| Category | Affected stage | Root cause / detection | Safeguard |
|---|---|---|---|
| C2 | acceptance-contract / D2.3 | Byte-identical fixtures demanded divergent attempt counts; a module counter hid the impossible contract until deterministic-state review. | For divergent expected outcomes, assert a risk-relevant fixture difference before implementation. |
| W | coding-agent / D2.4 | Auto-revert bypassed `revertProposal` and its whole-field scope guard, creating reachable privilege inversion; shared-guard review caught it. | Shared security/revert paths may be bypassed only after enumerating their guards and proving equivalent enforcement; prefer the shared path. |
| W | run-note ownership / D2.4 | Corrections were appended to superseded chronology and stale counts survived until verification searched them. | Rewrite stale sections in place; do not append corrective history to the current evidence section. |
| C1 | coding-agent / D2.5 | Eligibility was inferred from metadata rather than reversible snapshot compatibility. | Enrollment requires both emitted metadata and compatibility with the shared revert snapshot/path. |
| C5 | coding-agent / D2.5 | Awaited enrollment failure converted an already durable approval into HTTP 500. | Post-commit auxiliary lifecycle failures are isolated and cannot change durable success into API failure. |
| C1 | acceptance/verification / D2.5 | Contract statuses were marked pass for recursion, both states, Postgres, sweep, and isolation without direct binding assertions. | Map every criterion to the exact assertion; status/truthiness alone is insufficient. |
| C1 | verification / D2.5 | Final c12 gate omitted zero legacy-measure calls after enrollment rejection. | For composite criteria, enumerate each clause and bind each to an assertion before PASS. |
| P | orchestrator / D2.4 | Permission-blocked async agents looked dead; the orchestrator treated silence as cancellation and committed while verification was pending. | No-result/permission-blocked means pending; commit only after explicit readiness or confirmed cancellation. |
| P | tracker investigation | Investigation started in the wrong directory. The host queue was healthy but reported 109 lifetime dropped/unprocessable receipts. | Record only; tracker/artifact is host-owned and was not mutated in this retro. Investigate separately if current drops recur. |
| C4 | GitNexus | A stale worktree index returned zero symbols and misleading low risk. | Zero-symbol/stale-index evidence is `UNKNOWN`, never low. |
| C4 | full-suite verification | `relay_repl_contract` load flaked once and passed isolated. | Keep the manual gate: investigate isolated and compare baseline; never waive a one-off failure without evidence. |
| W | orchestrator / D2.4 | Commit occurred before independent verification returned readiness; later evidence repaired the record without rewriting history. | Make explicit verifier readiness/cancellation a commit precondition. |

## Outcome

- Production source, Git history, PR state, branches, deployment, tracker, and Dev Dashboard artifacts were not changed by this retrospective.
- Surgical workflow-text changes add fixture-difference, direct-assertion, shared-guard, reversible-enrollment, post-commit isolation, stale-note replacement, pending-verifier, and stale-GitNexus safeguards.
- `docs/ai/project-state.md` materially trails `a033a73a` and final verification; route a focused `project-state-updater` follow-up before the next PR-status claim.
