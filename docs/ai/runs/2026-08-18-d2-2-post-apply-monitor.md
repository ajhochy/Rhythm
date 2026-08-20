---
date: 2026-08-18
repo: Rhythm
branch: agent-stack/si-d2-post-apply-lifecycle
pr: none
issues: [1432]
status: pass
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# D2.2 (#1432) — post-apply guardrail monitor

Second issue of the D2 series. Depends on D2.1 (#1431, `c78fc725`) —
`PostApplyEventsRepository` / `PostApplyEvent`. Scope/results recorded in
`docs/ai/contracts/issue-1432.json`.

## Investigation findings (before implementation)

- `models/guardrail_registry.ts` (C3) exports `GUARDRAIL_NAMES` and
  `evaluateGuardrails(guardrails, ctx)` — confirmed closed/reusable exactly
  as the dispatch names them. No changes made to that file.
- `AgentRunOutcomesRepository` had NO profile-scoped, proposal-agnostic read.
  `listByExperimentAsync`/`listReceiptBackedByExperimentAsync` are both
  scoped to `experiment_variant IS NOT NULL` rows only — unusable for a
  monitor that must watch a profile's runs whether or not the applied change
  happened to run through the causal-runtime-v2 experiment machinery. Added
  `listByProfileSinceAsync(profileId, sinceIso)` plus a supporting index on
  both engines.
- `AgentOrgExperimentsRepository.listByProposalAsync(proposalId)` (used
  already by C4's `verifyTestedTargetStillMatches`) is the existing lookup
  to find any experiment tied to a proposal — reused to fold enrollment rows
  into the `treatment-integrity-failure-rate` guardrail check when a real
  experiment exists; empty otherwise (guardrail structurally never fires for
  a non-experiment proposal, which `checkTreatmentIntegrityFailureRate`
  already handles via its own `minSampleCount` floor — no new special case).
- `org_proposal_apply_service.ts`'s `registerProposalApplier` /
  `registerProposalValidator` + `resetProposalPluginsForTests` is the
  established "future generator/issue plugs in without touching this file's
  control flow" seam in this codebase — mirrored for the D2.3 auto-repair
  call site (`registerAutoRepairTrigger` / `resetAutoRepairTriggerForTests`)
  per the dispatch's explicit "stub the call site now" instruction.

## Design decisions (see `docs/ai/contracts/issue-1432.json` → `judgment_calls`)

1. Poll-driven, not push-driven: `evaluatePostApplyGuardrailsAsync` is meant
   to be called on a recurring sweep for every event still `monitoring` —
   matching the org-optimizer's existing cron-sweep architecture. Wiring an
   actual recurring caller is D2.5's scope.
2. Every applied proposal gets ALL closed-registry guardrails evaluated
   unconditionally (a blanket safety net), unlike C3's per-experiment
   DECLARED-subset mechanism, which is untouched.
3. `DEFAULT_MONITORING_WINDOW_MS` (1h) and the guardrail `minSampleCount`
   floor (5) are fixed ponytail-commented constants, matching C3/C4's
   established closed-constant style.
4. Auto-repair trigger seam mirrors the existing
   register*/resetProposalPluginsForTests pattern; a per-call
   `deps.triggerAutoRepair` override also exists for test isolation.

## Files changed

- `apps/api_server/src/services/post_apply_monitor.ts` (new) —
  `startPostApplyMonitoringAsync`, `evaluatePostApplyGuardrailsAsync`,
  `registerAutoRepairTrigger` / `resetAutoRepairTriggerForTests`.
- `apps/api_server/src/repositories/agent_run_outcomes_repository.ts` —
  added `listByProfileSinceAsync`.
- `apps/api_server/src/database/migrations.ts` /
  `apps/api_server/src/database/postgres_bootstrap.ts` — additive
  `idx_agent_run_outcomes_profile` index (both engines).
- `apps/api_server/src/services/__tests__/post_apply_monitor.test.ts` (new).
- `apps/api_server/src/repositories/__tests__/agent_run_outcomes_repository.test.ts` —
  added `D2.2 (#1432) profile-scoped since query` describe block.
- `docs/ai/contracts/issue-1432.json` (new).

## Checks

RED confirmed before implementation:

```
cd apps/api_server
npx vitest run src/services/__tests__/post_apply_monitor.test.ts
# Cannot find module '../post_apply_monitor'
```

GREEN after implementation (also re-ran D2.1's tests + guardrail_registry +
experiment/enrollment repo tests as a regression check):

```
cd apps/api_server
npx vitest run \
  src/models/__tests__/post_apply_event.test.ts \
  src/repositories/__tests__/post_apply_events_repository.test.ts \
  src/services/__tests__/post_apply_monitor.test.ts \
  src/repositories/__tests__/agent_run_outcomes_repository.test.ts \
  src/models/__tests__/guardrail_registry.test.ts \
  src/__tests__/skill_schema_parity.test.ts \
  src/repositories/__tests__/agent_org_experiments_repository.test.ts \
  src/repositories/__tests__/agent_org_experiment_enrollments_repository.test.ts
```
→ **8 files, 86 tests, all pass.**

- `node_modules/.bin/tsc --noEmit` → clean.
- `npm run build` → PASS (tsc + postbuild copy).
- `git diff --check` → clean.
- Per this worktree's gate policy: focused tests + build + tsc +
  `git diff --check` only; full `apps/api_server` suite deferred.

## Deviations / residual risk

- Hit one test-authoring bug during development (not a production defect):
  the monitor test initially didn't call `setDb(db)`, so the monitor's
  default-constructed `AgentRunOutcomesRepository()`/`AgentOrgExperimentsRepository()`
  fell back to a separate empty in-memory DB instead of sharing the test
  fixture's connection — outcomes seeded via raw SQL were invisible to the
  guardrail check. Fixed by adding `setDb(db)` in `beforeEach`, matching the
  sibling `agent_run_outcomes_repository.test.ts` convention. No production
  code was affected; documented here since it's exactly the kind of
  DB-wiring mistake this campaign has hit before (per `AGENTS.md`'s
  Postgres/SQLite drift note).
- D2.2 does NOT wire `startPostApplyMonitoringAsync` into any real apply
  path, and does NOT wire a real recurring sweep caller for
  `evaluatePostApplyGuardrailsAsync` — both are explicitly D2.5's scope. The
  auto-repair trigger remains the log-only stub until D2.3 registers a real
  one.
