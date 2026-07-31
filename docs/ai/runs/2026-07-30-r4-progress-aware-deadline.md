---
date: 2026-07-30
repo: Rhythm
branch: codex/r4-progress-aware-deadline
pr: null
issues: []
status: blocked_git_metadata_permissions
tags: [run, rhythm]
index: "[[Rhythm]]"
---

# R4 progress-aware deadline

## Files

- `apps/api_server/src/services/agent_runner.ts` — replaces the shared
  wall-clock deadline with inactivity plus hard-ceiling timers.
- `apps/api_server/src/server.ts` — keeps Undici beyond the configured hard
  ceiling.
- `apps/api_server/src/__tests__/r4_progress_aware_deadline.test.ts` — four
  fake-timer acceptance cases.
- `apps/api_server/src/__tests__/r4_progress_aware_deadline_live_e2e.test.ts` —
  env-gated real API/engine contract, written but intentionally not run.
- `docs/ai/contracts/r4-progress-aware-deadline.json` — executable acceptance
  contract.
- `docs/ai/decisions/2026-07-30-progress-aware-agent-runner-deadline.md` —
  policy and knob documentation.

## Checks

- Red baseline:
  `cd apps/api_server && npx vitest run src/__tests__/r4_progress_aware_deadline.test.ts`
  → 1 passed, 3 failed on the old wall-clock implementation. The passing case
  was parent cancellation propagation.
- Implementation:
  the same command → 4 passed.
- `cd apps/api_server && npx tsc --noEmit` → passed.
- Focused existing suites:
  `npx vitest run src/__tests__/issue_738_agent_runner.test.ts src/__tests__/issue_738_fix_model_and_session.test.ts src/__tests__/issue_892_mcp_preflight.test.ts src/__tests__/issue_1040_agent_runner_streaming.test.ts src/__tests__/issue_1216_mcp_preflight.test.ts`
  → 5 files, 39 tests passed.
- Expanded non-listening runner suites:
  `npx vitest run` over 15 direct runner/MCP/memory/skill/escalation files
  → 15 files, 124 tests passed.
- Live-test compilation/skip gate:
  `npx vitest run src/__tests__/r4_progress_aware_deadline_live_e2e.test.ts`
  → 1 file and 1 test skipped as designed without `RHYTHM_LIVE_E2E=1`.
- Listener-dependent runner-adjacent HTTP suites cannot execute in this
  managed workspace: `startTestServer()` fails `listen(0)` with `EPERM`.
  `issue_904_activity_log.test.ts` reproduced the restriction in isolation;
  no product assertion ran and no unrelated harness was edited.

## Deferred live check

Do not run from an implementation agent. The orchestrator may later run:

```bash
AGENT_RUN_TIMEOUT_MS=5000 \
AGENT_RUN_INACTIVITY_TIMEOUT_MS=5000 \
AGENT_RUN_HARD_TIMEOUT_MS=45000 \
  tools/dev/sandbox.sh up

cd apps/api_server
RHYTHM_LIVE_E2E=1 \
RHYTHM_LIVE_E2E_ISOLATED=1 \
RHYTHM_LIVE_URL=http://127.0.0.1:4098 \
DB_PATH=<sandbox-dir>/rhythm.db \
RHYTHM_LIVE_OLD_WALL_MS=5000 \
  npx vitest run src/__tests__/r4_progress_aware_deadline_live_e2e.test.ts
```

## Notes

- `agentSchedulerService.ts`, failure classification, `skill_extractor.ts`,
  and child-session persistence were not modified.
- The scheduler's `AGENT_RUN_TIMEOUT_MS` read is a stale-row reaper cutoff,
  not an engine-session abort enforcement site; it remains R3-owned.
- The 600,000 ms value in `ensureRhythmMcp` configures the Rhythm MCP server,
  not AgentRunner wall-clock execution.
- Commit/push is blocked in this managed session: Git cannot create
  `/Users/ajhochhalter/Documents/Rhythm/.git/worktrees/r4/index.lock`
  (`Operation not permitted`). The source worktree is writable, but its common
  Git metadata is read-only.
