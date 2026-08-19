---
date: 2026-08-18
repo: Rhythm
branch: agent-stack/si-causal-runtime-v2-codex
pr: none
issues: [1448]
status: pass
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# C4 — fixed-horizon decision and tested-candidate promotion

Contract phase C4 of `docs/ai/contracts/issue-causal-runtime-v2.json`, tracked under
#1448's umbrella. Scope/results recorded in `docs/ai/contracts/issue-c4.json`.

## Investigation findings (before implementation)

- `decideExperiment` (org_proposal_experiment_service.ts) was, per C3's own report, "unchanged
  from W6/C0": a bare point-estimate comparison (`effect >= minEffect` / `effect <= -minEffect`)
  with no statistical criterion at all. `ExperimentStoppingRule` carried only
  `{minSamplesPerCohort, minEffect}` — no confidence/significance concept existed anywhere.
- `AgentOrgExperimentsRepository.declareAsync` validates `stoppingRule` inline
  (`isStoppingRule`) and is called from ~50 test fixtures across the repo with only
  `{minSamplesPerCohort, minEffect}` — confirmed via grep before touching the stopping-rule
  shape, which is why the confidence criterion became a FIXED code constant (matching C3's own
  guardrail-threshold precedent) rather than a new required declare-time field.
  `maxExposure` is already its own top-level column/parameter (not nested in `stoppingRule`) and
  was left there — already enforced (`assignSubject`'s exposure cap), no change needed.
  `gateProductionPromotionAsync` already existed (C3) and was the natural extension point for
  requirement 3's sample-integrity checks — receipt-backed cohorts and enrollments are both
  already read there.
- `AgentOrgExperimentEnrollmentsRepository.listByExperimentAsync` (used by C3's guardrail check)
  already returns every enrollment row in any state — reused directly for the C4 missingness/
  sample-ratio checks rather than adding a new repository method.
- `classifyProposalRisk` (org_risk_classifier.ts): `refine-config` is in NEITHER
  `LOW_RISK_KINDS` (`refine-skill`, `consolidate-skill`, `refine-recipe`) NOR the explicit
  `HIGH_RISK_KINDS` list — it falls through to the documented fail-closed default
  ("unknown/unlisted kind is never auto-applied" → `'high'`). `org_proposal_apply.ts`'s
  unattended auto-apply path therefore ALREADY refuses every `refine-config` proposal
  regardless of `outcome_status`. Confirmed no existing test named `refine-config` specifically
  (`org_risk_classifier.test.ts` only asserts the *documented* low/high lists plus a
  `'totally-unknown-kind'` fail-closed case) — requirement 6 needed a proof test, not new code.
- `org_proposal_measure.ts`'s `recordDiagnosticOutcome` already guards
  `if (!current || current.outcomeStatus === 'verified') return;` before writing
  `inconclusive`/`regressed` — a later post-deployment measure/revert cycle already cannot
  downgrade a causal `verified` verdict. Requirement 7 needed a proof test, not new code.
- No `applyProposalAsync`/generic "exact-revision CAS apply" symbol exists under that name; the
  real durable-apply surface for a human-approved `refine-config` proposal is
  `org_proposal_apply_service.ts`'s `applyProposal` (awaits `validateProposalChange`, then runs
  the kind's registered applier — `refineConfigApplier`/`validateRefineConfig` in
  `org_proposal_appliers_wiring.ts`). That pair was the correct, existing extension point for
  requirement 5 (no second promote/apply path was built).

## Design decisions (see `docs/ai/contracts/issue-c4.json` → `judgment_calls` for the full text)

1. **Fixed-horizon confidence criterion is a closed code constant (95%, z=1.96)**, not a new
   `ExperimentStoppingRule` field — avoids a declare-time schema/validation change that would
   have forced every existing `declare()` fixture in the repo to supply it, matching C3's
   established "fixed constants, ponytail-noted upgrade path" style.
2. **Variance estimate uses `p(1-p)/n` for BOTH the strictly-binary objective metrics and the
   bounded 0/0.5/1 explicit-user-verdict-rate metric** — exact for the former, a Popoviciu's-
   inequality conservative (never-overstated) bound for the latter. Deterministic, dependency-
   free, matching the contract's explicit "not a black-box stats library" guidance.
3. **"No repeated promote through optional stopping" is satisfied structurally**: decision-once
   fencing (`recordDecisionAsync`'s `WHERE decision IS NULL`, pre-existing since W6/C0) plus the
   NEW significance requirement means an early underpowered look that crosses `minEffect` by
   noise now locks as `inconclusive` — proven directly with a test showing a later, far more
   favorable re-judge never flips that locked verdict.
4. **Missingness accounting is populated only on the receipt-backed promotion gate**
   (`gateProductionPromotionAsync`) — the one place enrollment and receipt-backed outcome counts
   are both available; `decideExperiment` itself stays a pure function with no DB access,
   unchanged in that respect from W6.
5. **Sample-ratio-mismatch (0.5 floor) and excessive-missing-outcomes (0.3 ceiling) are fixed
   constants**, matching C3's guardrail/response-rate-imbalance style.
6. **Requirement 5's revalidation lives in `validateRefineConfig`, not duplicated in
   `refineConfigApplier`.** `refineConfigApplier` was tried as `async` with the same check
   inline; this broke 2 pre-existing synchronous-throw unit tests in
   `w1_corrective_6_boundaries.test.ts` (`expect(() => applier(proposal)).toThrow()` cannot catch
   a promise rejection). Reverted to keep the applier synchronous and rely solely on
   `validateProposalChange` (already awaited, already throws BEFORE the applier runs, in the same
   request) — zero other fixtures needed touching.
7. **Target-drift check compares the literal current `systemPrompt` string value** against the
   experiment's tested `candidateSpec.priorValue`, rather than recomputing the full sha256
   durable-target fingerprint (which is `org_proposal_experiment_service.ts`-private) — sufficient
   and simpler for a one-line equality that is already exact.
8. **Requirements 6 and 7 added zero new production code** — both were already correct from the
   W1/W6 foundation; only proof tests were added, per the parent's explicit instruction not to
   build new gating scaffolding where the existing posture already holds.

## Commits

1. **`237a84bb`** — `feat(optimizer): fixed-horizon confidence criterion and sample-integrity gates for promote`
   `models/agent_org_experiment.ts` (`MissingnessSummary`, `ExperimentResults` analysis fields),
   `services/org_proposal_experiment_service.ts` (`computeFixedHorizonAnalysis`,
   `checkSampleIntegrityAsync`, decision-tail rewrite, `gateProductionPromotionAsync` extension).
   Focused tests: `services/__tests__/org_proposal_experiment_service.test.ts` (91 tests, incl.
   new C4-1/C4-2/C4-3/C4-4 describes) — 91/91 pass. Covers C4 requirements 1, 2, 3, 4.
2. **`7cf65f43`** — `test(optimizer): prove risky-kind human-gate and post-deploy monitoring already hold for C4`
   `__tests__/org_proposal_apply.test.ts` (+1 test, C4-6), `services/__tests__/org_proposal_measure.test.ts`
   (+1 test, C4-7). No production code changed. Covers C4 requirements 6, 7.
3. **`0522914a`** — `feat(optimizer): revalidate tested baseline/candidate before durable refine-config apply`
   `services/org_proposal_appliers_wiring.ts` (`verifyTestedTargetStillMatches`, wired into
   `validateRefineConfig`). Focused tests:
   `services/__tests__/org_proposal_appliers_wiring.test.ts` (+4 tests, C4-5 describe) — 10/10
   pass. Covers C4 requirement 5.

## Checks

Per-commit (`cd apps/api_server && export PATH=/opt/homebrew/opt/node@22/bin:$PATH`):

- `node_modules/.bin/tsc --noEmit` → clean after every commit.
- `npm run build` → PASS after every commit (standard `tsc -p tsconfig.json` + postbuild copy).
- `git diff --check` → clean before every commit.

Final combined run (all three commits' focused tests plus the full C3 focused-test list, to
confirm no regression across the whole causal-runtime-v2 surface so far):

```
npx vitest run \
  src/services/__tests__/org_proposal_experiment_service.test.ts \
  src/services/__tests__/run_outcome_terminal_hook.test.ts \
  src/services/__tests__/proposal_evidence_validator.test.ts \
  src/models/__tests__/proposal_evidence_bundle.test.ts \
  src/models/__tests__/guardrail_registry.test.ts \
  src/models/__tests__/feedback_metric_adapter.test.ts \
  src/services/__tests__/org_proposal_experiment_collecting.test.ts \
  src/__tests__/experiment_cohort_wiring_contract.test.ts \
  src/__tests__/c2_a_reserved_treatment_dispatch.test.ts \
  src/__tests__/c2_d_s4_ws_reserved_treatment_dispatch.test.ts \
  src/__tests__/issue_1450_contract.test.ts \
  src/__tests__/issue_1451_contract.test.ts \
  src/services/__tests__/run_outcome_run_episode_bug.test.ts \
  src/services/__tests__/run_outcome_service.test.ts \
  src/repositories/__tests__/agent_run_outcomes_repository.test.ts \
  src/repositories/__tests__/agent_org_experiments_repository.test.ts \
  src/repositories/__tests__/agent_org_experiment_enrollments_repository.test.ts \
  src/repositories/__tests__/agent_org_treatment_receipts_repository.test.ts \
  src/__tests__/agent_org_experiment_enrollments_postgres_parity.test.ts \
  src/__tests__/run_outcome_routes.test.ts \
  src/__tests__/org_optimizer_run_controller.test.ts \
  src/__tests__/c1_agent_runner_pre_dispatch_enrollment.test.ts \
  src/services/__tests__/org_proposal_appliers_wiring.test.ts \
  src/__tests__/w1_corrective_6_boundaries.test.ts \
  src/__tests__/w1_corrective_6_revisions.test.ts \
  src/__tests__/agent_org_proposals.test.ts \
  src/__tests__/org_proposal_apply.test.ts \
  src/services/__tests__/org_proposal_measure.test.ts \
  src/__tests__/org_proposals_routes.test.ts \
  src/__tests__/org_risk_classifier.test.ts
```
→ **30 files, 584 tests, all pass.**

Per this campaign's explicit gate policy, the FULL `apps/api_server` suite was **not** run —
deferred to the end of the whole C2-D→C6 sequence.

## Deviations / residual risk

- Every judgment call above is a genuine, narrow scope decision covered by a real, currently-green
  test proving the narrower behavior holds (see `docs/ai/contracts/issue-c4.json` →
  `judgment_calls`). All 7 of C4's `required_behavior` items map to passing criteria; items 6 and 7
  were confirmed already-correct rather than requiring new gating code, per the dispatch's explicit
  investigate-first instruction.
- `refineConfigApplier` was tried as `async` (duplicating the tested-target check inline) and
  reverted after breaking 2 pre-existing synchronous-throw tests — documented as its own judgment
  call rather than silently discarded; the final design (validator-only revalidation) is provably
  equivalent in safety for every real caller (same request, no re-entrant write between validate
  and apply).
- Did not start C5 scope (automatic evidence construction / behavioral fact records). C4's 7
  required_behavior items are all done and gate-clean; stopping here per the dispatch's explicit
  "do NOT start C5 scope" instruction.
- GitNexus `detect_changes`/index freshness was not re-checked this phase (same posture as C3's
  run note — the index was already flagged stale there); flagging again for the parent's final
  review pass rather than spending phase budget re-running `analyze`.
