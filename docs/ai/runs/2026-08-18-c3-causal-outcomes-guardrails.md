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

# C3 — treatment-bound outcomes, executable metrics, and guardrails

Contract phase C3 of `docs/ai/contracts/issue-causal-runtime-v2.json`, tracked under
#1448's umbrella. Scope/results recorded in `docs/ai/contracts/issue-c3.json`.

## Investigation findings (before implementation)

- `org_proposal_experiment_service.ts` is the single decision engine (`decideExperiment` /
  `computeDecisionAsync` / `judgeExperimentAsync`); `AgentOrgExperimentsRepository.declareAsync`
  does NOT itself call `validateEvidenceBundle` (only checks required-string presence + adapter
  match) — full bundle validation (including guardrails) lives entirely in
  `proposal_evidence_validator.ts`, invoked by `OrgProposalsController.declareExperiment` and
  again, read-side, by `findEligibleExperiment`/`decideExperiment`.
- `guardrails: string[]` was genuinely free text — `validateEvidenceBundle` only checked
  "non-empty array of strings," and nothing anywhere executed a guardrail. Confirmed via grep:
  every existing test fixture used a human sentence (`'none'`, `'revert if the terminal error
  rate rises'`, etc.).
- C2-D (S2) / #1450 already built `AgentRunOutcomesRepository.listReceiptBackedByExperimentAsync`
  (a real, tested, receipt-JOIN cohort read) but deliberately left it unwired — `issue-1450.json`'s
  own `c4` criterion documents that wiring it into `computeDecisionAsync` unconditionally would
  silently change interim results/decision counts for ~20 pre-existing tests across
  `org_proposal_experiment_service.test.ts`, `org_proposal_experiment_collecting.test.ts`, and
  `experiment_cohort_wiring_contract.test.ts` — and explicitly deferred that wiring to C3/C4.
  Confirmed by running those suites before touching `computeDecisionAsync`: every one of those
  tests seeds ledger rows with `finalizeAsync` directly and NO treatment receipt.
- `recordTerminalOutcome` (`run_outcome_service.ts`) already resolves a `RunEnrollment` via
  `resolveRunEnrollment` for cohort/proposal labelling, but `profileId`/`configRevision` on the
  written outcome came only from `event.profileId`/`event.configRevision` — and grepping every
  real call site (`agent_runner.ts` x2, `opencode_stream_bridge.ts` x3) showed NONE of them ever
  pass those fields, so they were permanently `null` in production despite the run's real
  profile/revision identity already being known at RESERVATION time.

## Design decisions (see `docs/ai/contracts/issue-c3.json` → `judgment_calls` for the full text)

1. **Receipt-filtered judgement is scoped to the promote branch only.** A new
   `gateProductionPromotionAsync` re-checks any raw `'promote'` decision against
   `listReceiptBackedByExperimentAsync`-filtered cohorts under the identical stopping rule,
   replacing the old unconditional C0 block. regress/inconclusive/collecting keep reading the
   unfiltered ledger — this matches the contract's global invariant text (which names `verified`
   specifically) and preserves every pre-existing regress/inconclusive-reachability test
   `issue-1450.json` flagged as deliberately deferred. Proven forward-compatible with a new test
   that reaches real `promote`/`verified` once genuine treatment-v2 receipts back both cohorts,
   and a regression test proving an unfiltered A/A-shaped effect still refuses.
2. **"Internally inconsistent verdict/evidence pair" exclusion is narrow: direct self-contradiction
   only** (stored `success` + `terminalStatus` in `{error, aborted}`, or `producedArtifact ===
   false`, or `errorCount > 0`), applied inside `objective-success-rate`'s own numerator — the row
   still counts toward the sample size (audit trail preserved). A full recomputation-equality
   check against `finalizeVerdict` was considered and rejected: nearly every existing test fixture
   in the repo uses null/unknown evidence with an asserted verdict (fixture convenience), which is
   ambiguity, not contradiction, and a recomputation check would have wrongly excluded almost every
   row in the codebase's test suite.
3. Requirement 3 ("keep objective-success-rate fail closed... completed with unknown produced
   artifact is unknown, not success") is satisfied as a **regression guard on the existing
   write-time behavior** (`finalizeVerdict`), not a new read-time filter — that property already
   holds and is the reason the metric can never be gamed by omitted evidence at write time.
4. Guardrail thresholds (`terminal-error-rate > 0.5`, `treatment-integrity-failure-rate > 0.3`) and
   the response-rate imbalance ceiling (`0.2`) are fixed constants (ponytail-commented), matching
   the closed/fixed style of `EXPERIMENT_ADAPTERS` — not per-bundle configurable in this phase.
5. Guardrail-breach enforcement runs synchronously inside `reserveRunEnrollment`, protected by the
   same `recordDecisionAsync` `WHERE decision IS NULL` guard already used for idempotent
   reservation elsewhere — not a new cross-process transaction. A once-per-experiment race window
   is the same class of atomicity this codebase already accepts for the exposure cap.

## Commits

1. **`d0df5421`** — `feat(optimizer): add closed guardrail registry and explicit-user-verdict-rate metric adapter`
   New standalone pure modules: `models/guardrail_registry.ts`, `models/feedback_metric_adapter.ts`.
   Focused tests: `models/__tests__/guardrail_registry.test.ts` (6 tests),
   `models/__tests__/feedback_metric_adapter.test.ts` (5 tests) — 11/11 pass.
2. **`b6c15170`** — `feat(optimizer): wire the closed guardrail registry into evidence validation, add consistency-checked objective-success-rate`
   `proposal_evidence_validator.ts` (closed guardrail-name check, `explicit-user-verdict-rate` +
   `minResponseCoverage` validation), `proposal_evidence_bundle.ts` (`contradictsSuccessVerdict`,
   `KNOWN_METRIC_NAMES`), `agent_org_experiment.ts` (`CohortResult.responseRate`), plus the
   mechanical guardrail-fixture migration across 8 test files that only needed a bundle-value fix.
   Focused tests: `proposal_evidence_validator.test.ts` (30 tests, incl. new C3-4/C3-5 describes),
   `models/__tests__/proposal_evidence_bundle.test.ts` (9 tests) — 39/39 pass, plus the 8 migrated
   fixture files' full suites verified green (see "Checks" below).
3. **`d4be6681`** — `feat(optimizer): bind causal outcomes to enrollment identity, gate promote on treatment-v2 receipts, add explicit-user-verdict-rate decisions, and stop enrollment on guardrail breach`
   `agent_run_outcomes_repository.ts` (`listLatestExplicitUserVerdictsAsync`),
   `run_outcome_service.ts` (`profileId`/`configRevision` from enrollment), `org_proposal_experiment_service.ts`
   (`RunEnrollment`/`resolveRunEnrollment` extended; `decideExperiment` feedback-metric branch +
   response-rate-imbalance/coverage gates; `gateProductionPromotionAsync` replacing
   `gateProductionPromotion`; `guardrailsBreachedAsync` wired into `reserveRunEnrollment`), plus
   `docs/ai/contracts/issue-c3.json`.
   Focused tests: `org_proposal_experiment_service.test.ts` (83 tests, incl. new C3-1/C3-4/C3-6
   describes), `run_outcome_terminal_hook.test.ts` (14 tests, incl. new C3-1 describe) — 97/97 pass.

## Checks

Per-commit and final combined run (`cd apps/api_server && export PATH=/opt/homebrew/opt/node@22/bin:$PATH`):

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
  src/__tests__/c1_agent_runner_pre_dispatch_enrollment.test.ts
```
→ **22 files, 278 tests, all pass.**

- `node_modules/.bin/tsc --noEmit` → clean (run after every commit).
- `npm run build` → PASS (run after every commit; standard `tsc -p tsconfig.json` + postbuild copy).
- `git diff --check` → clean (run before every commit, and once more over the full `6f972e46..d4be6681` range).
- Per this campaign's explicit gate policy, the FULL `apps/api_server` suite was **not** run —
  deferred to the end of the whole C2-D→C6 sequence.

## Deviations / residual risk

- **GitNexus `detect_changes` unavailable.** `Rhythm-causal-runtime-v2-codex`'s index reported
  `LadybugDB unavailable ... Database file version: 42, Current build storage version: 41` (a
  stale/incompatible index, not a code issue). Did not spend time re-running `analyze` to rebuild
  it, given this session's explicit gate list (focused tests + build + tsc + git diff --check) and
  effort budget; flagging so the parent can re-index before/at final review if a GitNexus-based
  compare-to-main pass is wanted.
- Every judgment call above is a genuine scope-narrowing decision, not a shortcut around a required
  behavior — each is covered by a real, currently-green test proving the narrower behavior actually
  holds (see commit list). None of C3's 7 required_behavior items were skipped; `issue-c3.json`
  maps all 7 to passing criteria.
- Did not touch `gateProductionPromotion`'s callers outside `computeDecisionAsync`/`judgeExperimentAsync`
  — `org_optimizer_run_service.ts`'s sweep loop was not modified and needed no change (it already
  calls `computeDecisionAsync`/`judgeExperimentAsync` and reports `tally.promoted` generically).
- Did not start C4 scope (fixed-horizon stopping rule / statistical decision procedure). The
  `decideExperiment` mean-difference-vs-minEffect comparison used for promote/regress is
  unchanged from W6/C0 — C4 is where that gets replaced with a real statistical analysis.
