---
date: 2026-10-12
repo: rhythm
branch: feature/coordinator-workflow-runs-mega
pr: none (local only, not pushed)
issues: []
status: ported-and-verified-locally
tags: [run, rhythm]
---

## Goal
Port the coordinator workflow runs feature (feature/coordinator-workflow-runs, commits d03bf90e, f8d2a9bb,
607a28b4, 3582ce65, 33585c8e) from the deliverables base onto mega (edb7158c), without the 57
deliverables commits. Intent: [runs/2026-10-12-coordinator-workflow-runs.md](2026-10-12-coordinator-workflow-runs.md).

## Files
- Prerequisites from deliverables: ff3e1717 (seeded workflow-orchestrator / coding-agent /
  verification-gate / acceptance-contract skills, config_seeds v4), 75253cbe (goal-capture verbs
  add/give/change/…), and from c6002804 only the sandbox.sh `RHYTHM_WORKSTREAMS_ENABLED` passthrough.
- Retired on mega: `chat_bounded_workflow.ts`, `rhythm_propose/start_bounded_coding_workflow` tools and
  routes, the `coordinator.workflow.start` card (Transcript/store), the finite `workflow` purpose and the
  typed Coding Workflow adapter (delegation input/receipt, `coding_workflow_dispatch_v1` prompt context,
  `enrollWorkflowProviderGuard`, coverage inspector, workflow job/membership parts) and their tests and
  live scripts. Mega had no `coordinator_coding_*` layer.
- Kept mega's own code where deliverables differed: no approval expiry gate, no capacity_router import,
  no clearStaleTurnError / reachableMcpDispatcher, no managed-run reconcile in the card hook,
  `commandDedupe` instead of the deliverables command journal for `startableGoals`.
- From 253a5d97 only the sandbox.sh exit-status fix (cleanup `stop` in a subshell; no wait on itself).
- testing-guide: retired live chat-bounded section replaced by the coordinator runs live check.

## Checks
- Mega baseline (edb7158c, same worktree, isolated HOME): api_server 8632 tests, 0 failed, 320 skipped.
- Final: api_server 8410 tests, 0 failed, 318 skipped. New failures: none.
- `tsc --noEmit` api_server / mcp_server / web and web `tsc -b`: exit 0.
- Focused api (coordinator_, async_delegation, agent_delegation, opc_question): 342 passed, 5 skipped.
  mcp_server: 224 passed, 2 skipped. Web unit tests: 79/79.
- Not run: live sandbox demo / `coordinator_workflow_runs_live.test.ts` (env-gated), Electron, Playwright.

## Notes
- Left as on the source branch: Dayflow schema-2 workflow provider-guard types/optional deps (now
  unwired), `listMessagesPageStrict` (tested, no production caller).
- No package.json/lockfile changes.
