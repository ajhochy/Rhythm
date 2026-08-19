---
date: 2026-08-18
repo: Rhythm
branch: agent-stack/si-causal-runtime-v2-codex
pr: none
issues: [1450]
status: pass
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# C2-D (S2) / #1450 — run_episode_id column + receipt-backed filtering capability

## Files

- `apps/api_server/src/database/migrations.ts` — additive `run_episode_id TEXT` column on
  `agent_run_outcomes` (guarded `ALTER TABLE`, matching the existing `outcome_status` pattern) +
  supporting index.
- `apps/api_server/src/database/postgres_bootstrap.ts` — Postgres twin (`ADD COLUMN IF NOT EXISTS`)
  + index, single-line so `skill_schema_parity.test.ts`'s parser catches drift.
- `apps/api_server/src/models/agent_run_outcome.ts` — `runEpisodeId: string | null` on
  `AgentRunOutcome`.
- `apps/api_server/src/repositories/agent_run_outcomes_repository.ts` —
  `FinalizeOutcomeInput.runEpisodeId`, persisted through `finalizeAsync` (both engines); new
  `listReceiptBackedByExperimentAsync(experimentId, proposalId)` — INNER JOINs
  `agent_run_outcomes` to `agent_org_experiment_treatment_receipts` on `run_episode_id`, scoped to
  the exact experiment + proposal.
- `apps/api_server/src/services/run_outcome_service.ts` — `recordTerminalOutcome` now passes the
  already-computed `runEpisodeId` (line ~213: `event.runEpisodeId ?? rootSessionId`) into
  `repo.finalizeAsync`.
- `apps/api_server/src/services/__tests__/org_proposal_experiment_service.test.ts` — one-line fixture
  fix (`runEpisodeId: null` added to the `cohort()` helper) required because `AgentRunOutcome.runEpisodeId`
  is now a required field; no behavioral change to the test.
- `apps/api_server/src/__tests__/issue_1450_contract.test.ts` — new, 8 tests, all 4 criteria.
- `docs/ai/contracts/issue-1450.json` — acceptance contract.

## Checks

- RED: stashed the 5 implementation files, ran the contract test —
  `npx vitest run src/__tests__/issue_1450_contract.test.ts` → **8/8 failed** (missing column,
  missing field, missing method), captured in the transcript before restoring.
- GREEN: `npx vitest run src/__tests__/issue_1450_contract.test.ts` → **8/8 passed**.
- Regression sweep of every directly-related pre-existing suite (repository, service, terminal hook,
  S1 bug fix, W6/C1/C2 experiment service, C0 collecting, cohort-wiring contract, migrations
  self-heal, schema parity, outcome routes, treatment receipts repo/model):
  `npx vitest run <13 files>` → **8 test files run separately, all passed; 135 + 30 + 8 + 23 = 196
  tests, 0 failed** (see commands below).
  - `npx vitest run src/repositories/__tests__/agent_run_outcomes_repository.test.ts src/services/__tests__/run_outcome_service.test.ts src/services/__tests__/run_outcome_terminal_hook.test.ts src/services/__tests__/run_outcome_run_episode_bug.test.ts src/services/__tests__/org_proposal_experiment_service.test.ts src/services/__tests__/org_proposal_experiment_collecting.test.ts src/__tests__/experiment_cohort_wiring_contract.test.ts src/__tests__/migrations_self_heal.test.ts` → 8 files / 135 passed
  - `npx vitest run src/__tests__/run_outcome_routes.test.ts src/repositories/__tests__/agent_org_treatment_receipts_repository.test.ts src/models/__tests__/agent_org_treatment_receipt.test.ts` → 3 files / 38 passed
  - `npx vitest run src/__tests__/skill_schema_parity.test.ts` → 23 passed (this is the existing
    dual-engine column-set parity guard; it already lists `agent_run_outcomes` and auto-validated the
    new column matches on both engines).
- `npm run build` → PASS (tsc + postbuild).
- `npx tsc --noEmit` (via `./node_modules/.bin/tsc --noEmit`, `npx tsc` resolves to the wrong binary
  in this workspace) → clean, 0 errors.
- `git diff --check` → clean.
- `detect_changes()` (GitNexus, worktree-scoped) → risk_level `low`, 0 affected processes.

## Decisions / deviations

- **Scoped the receipt-backed filtering to a new, additively-tested repository method
  (`listReceiptBackedByExperimentAsync`) rather than swapping it into the existing
  `judgeExperimentAsync`/`computeDecisionAsync` production call sites.** The GH issue body's scope
  item #4 and acceptance line ("promotion path queries only receipt-backed outcomes") read as if the
  live judge path should change today. But the tracking issue (#1448) explicitly splits that exact
  wiring into two SEPARATE, still-"Not started" future phases: **C3 "Judgement/adjudication gated by
  receipts"** and **C4 "Promotion gated by receipt-filtered outcomes"**. Swapping the query now would
  silently flip `enrolled` cohorts from real counts to empty (no test fixture in the repo creates
  receipts yet) for every existing test that drives `judgeExperimentAsync`/`runOrgOptimizer` end to
  end — roughly 20 assertions across `org_proposal_experiment_service.test.ts`,
  `org_proposal_experiment_collecting.test.ts`, and `experiment_cohort_wiring_contract.test.ts` —
  turning `decided`/`regress`/`inconclusive`-with-real-sample-counts into `collecting` across the
  board. That is real, necessary work for C3/C4 (which will also need to wire real receipt creation
  into those fixtures, e.g. via `reserveRunEnrollment` → `prepareReservedTreatment` →
  `commitReservedTreatmentDispatch`, exactly as this issue's own `issue_1450_contract.test.ts` does),
  but it is out of S2's bounded scope per the tracking issue's own phase split. Narrowest fail-closed
  choice consistent with the contract: build and prove the filtering capability now (additive, zero
  risk to existing behavior), leave the live-path swap to C3/C4 where it's explicitly tracked.
  Recorded in `docs/ai/contracts/issue-1450.json` criterion `issue-1450-c4.reason` and here.
- Did not add a UNIQUE constraint on `agent_run_outcomes.run_episode_id` — the ledger's identity stays
  `root_session_id` (unchanged); `run_episode_id` is a plain additive column + non-unique index for
  the join.
- `npx tsc` on the command line resolved to some other global binary printing "This is not the tsc
  command you are looking for" instead of the project's TypeScript — used
  `./node_modules/.bin/tsc --noEmit` directly instead. Environment quirk, not a code issue.
