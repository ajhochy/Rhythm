---
date: 2026-07-30
repo: Rhythm
branch: codex/r3-scheduled-failure-classification
pr: null
issues: [r3-scheduled-failure-classification]
status: partial
tags: [run, Rhythm]
---

# R3 scheduled-failure classification

## Files

- `apps/api_server/src/services/agentSchedulerService.ts`
  - Requires a successful engine `listMcp()` round-trip before scheduled
    session work.
  - Defers engine-cold tasks once with `engine_not_ready`; categorizes terminal
    scheduler and restart results.
- `apps/api_server/src/services/agent_runner.ts`
  - Classifies every error result before teacher escalation; only
    `model_quality` escalates.
- `apps/api_server/src/services/agent_run_failure_classification.ts`
  - Adds the R3 failure taxonomy and durable result formatter.
- `apps/api_server/src/__tests__/r3_*.test.ts`
  - Deterministic classification/readiness/restart coverage plus the written,
    unexecuted live contract.
- `docs/ai/contracts/r3-scheduled-failure-classification.json`
  - Seven acceptance criteria.

## Checks

- `npm install` (worktree root)
  - PASS: added 217 packages; audited 220 packages.
  - Reported 12 dependency vulnerabilities (1 low, 7 moderate, 4 high);
    no audit mutation attempted.
- Red contract:
  - `cd apps/api_server && npx vitest run src/__tests__/r3_failure_classification.test.ts src/__tests__/r3_scheduled_engine_readiness.test.ts`
  - EXPECTED FAIL: 2 files failed; 10/10 tests failed on the base behavior.
- Static:
  - `cd apps/api_server && npx tsc --noEmit`
  - PASS (exit 0). An earlier run found one CommonJS-incompatible
    `import.meta` in the new test loader; failure-triage repaired it and the
    command was rerun cleanly.
- Build:
  - `cd apps/api_server && npm run build`
  - PASS (exit 0), including `postbuild`.
- R3 + scheduler/teacher focus:
  - `cd apps/api_server && npx vitest run src/__tests__/r3_failure_classification.test.ts src/__tests__/r3_scheduled_engine_readiness.test.ts src/__tests__/teacher_escalation.test.ts src/__tests__/issue_1222_startup_burst_engine_wait.test.ts src/__tests__/issue_739_scheduler_agent_runner.test.ts src/__tests__/issue_1214_scheduler_quarantine.test.ts src/__tests__/scheduler_dispatch_contract.test.ts src/__tests__/prod_trigger_parity_contract.test.ts src/__tests__/issue_738_fix_stale_run_recovery.test.ts`
  - PASS: 9 files; 56/56 tests.
- Runner/refiner focus:
  - `cd apps/api_server && npx vitest run src/__tests__/issue_738_agent_runner.test.ts src/__tests__/issue_738_fix_model_and_session.test.ts src/__tests__/teacher_escalation.test.ts src/__tests__/skill_refiner.test.ts src/__tests__/skill_refiner_provider_fallback.test.ts src/__tests__/issue_1223_contract.test.ts`
  - PASS: 6 files; 75/75 tests.
- Full api_server attempt, excluding the R3 live file:
  - `cd apps/api_server && npx vitest run --exclude src/__tests__/r3_scheduled_failure_live_e2e.test.ts`
  - ENVIRONMENT FAIL, terminated after repeated unrelated 15-second socket
    failures. Decisive output:
    `listen EPERM: operation not permitted 127.0.0.1`.
  - Observed affected suites included `engraph_manager.test.ts`,
    `agents_ws_e2e.test.ts`, `research_vault_notes.test.ts`,
    `issue_1170_mobile_realtime_proxy.test.ts`,
    `opc_curated_mcp_token_bridge.test.ts`, and
    `issue_1169_mobile_opencode_proxy.test.ts`.
- GitNexus:
  - `detect-changes --scope unstaged --limit 120`
  - LOW risk; 9 tracked files / 14 indexed symbols; 0 execution flows.
- `git diff --check`
  - PASS (no output).

## Notes

- `skill_refiner.ts` has no independent teacher-retry decision. Its judge,
  scorer, and rewriter call `AgentRunner.run()` and fail closed on an error;
  the single escalation decision remains `agent_runner.shouldEscalate`.
- Live test command is documented in
  `r3_scheduled_failure_live_e2e.test.ts`; it was not run because the user
  explicitly prohibited sandbox/server/engine startup.
- No server was started and no port was bound by this workstream.
- Commits created: `429e702ad`, `5533236a8`, `11bac4975`.
- Branch pushed to
  `origin/codex/r3-scheduled-failure-classification`.
- GitHub Actions created Mobile CI run `30575049961` at `11bac4975`, initially
  queued. Two required `gh run watch --exit-status 30575049961` attempts
  failed locally with `error connecting to api.github.com`; no CI conclusion
  was observed.
