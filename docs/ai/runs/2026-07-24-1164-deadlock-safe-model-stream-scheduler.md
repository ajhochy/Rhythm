---
date: 2026-07-24
repo: Rhythm
branch: codex/1164-agent-run-scheduler
pr: null
issues: [1164]
status: complete
tags: [run, Rhythm]
---

# #1164 deadlock-safe model-stream scheduler

## Files

- Added `apps/opencode_fork/packages/opencode/src/session/model-stream-scheduler.ts`.
- Integrated the scheduler in fork `session/llm.ts`, `tool/task.ts`, and the
  experimental config schema.
- Added direct scheduler, LLM integration, and Task parent-yield regressions.
- Added the env-gated real 50-child engine/API contract:
  `apps/api_server/src/__tests__/live_e2e_1164_fifty_reader_swarm.test.ts`.
- Added `docs/ai/contracts/issue-1164.json` and the maintained-divergence
  decision note.

## Checks

- Pre-implementation:
  `bun test src/session/model-stream-scheduler.test.ts` — 0 passed / 9 failed
  with the intended missing-scheduler assertion.
- `bun run typecheck && bun test src/session/model-stream-scheduler.test.ts
  test/session/llm.test.ts test/tool/task.test.ts` — exit 0; 41 passed.
- `bun test test/session/ src/session/ test/tool/task.test.ts` — exit 0; 392
  passed, 4 skipped, 1 todo, 0 failed.
- `cd apps/api_server && npx tsc --noEmit && npx vitest run
  src/__tests__/live_e2e_1164_fifty_reader_swarm.test.ts` — exit 0; live test
  collected and skipped because `RHYTHM_LIVE_E2E` was not set.
- `ai-workflow checks --level issue` — exit 0 (Flutter analyze/format, API
  TypeScript, MCP TypeScript).
- `ai-workflow checks --level pr` — exit 0 (Flutter analyze/format/tests,
  API typecheck/lint/Vitest/build, MCP typecheck/Vitest/build, fork typecheck
  and session tests).
- Final post-live API merge-equivalent gate:
  `npx vitest run --fileParallelism=false --testTimeout=15000
  --hookTimeout=15000` — 359 files / 3,179 tests passed; 31 files / 50
  env-gated tests skipped. Flutter, API lint/build, MCP tests/build, fork
  typecheck, and fork session tests were green in the immediately preceding
  PR-gate runs.

## Notes

- GitNexus impact before edits: LOW for `streamLimiter`, `LLM.stream`,
  `TaskTool.run`, and `Config.Info`; no affected indexed execution process.
- The fork subtree's older MCP-only editing boundary is intentionally
  overridden by issue #1164, which explicitly requires changes in `llm.ts`
  and `task.ts`. The divergence is isolated and documented.
- Live criterion `issue-1164-c10` passed against the branch-built isolated
  API `:4498` and engine `:4497`:

  ```bash
  RHYTHM_LIVE_E2E=1 \
  RHYTHM_LIVE_E2E_ISOLATED=1 \
  RHYTHM_LIVE_URL=http://127.0.0.1:4498 \
  RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:4497 \
  DB_PATH=/tmp/rhythm-dev-sandbox-1164/rhythm.db \
  npx vitest run src/__tests__/live_e2e_1164_fifty_reader_swarm.test.ts
  ```

  Result: 1/1 PASS in 22.60s. The assertion required all 50 real child
  sessions to return `READY-1164`; a partial swarm would fail the exact
  `toHaveLength(50)` invariant.
- Two fail-first live attempts strengthened the harness before the green run:
  the first exposed the real model catalog field as `provider` rather than
  `providerId`; the second exposed stale catalog entry `openai/gpt-5-mini` as
  unavailable in the running engine. The gate now selects the authorized,
  engine-supported `openai/gpt-5.4-mini` and retains a fallback.
- The first launcher attempt also proved that a completed desktop exec cell
  reaps its child process despite `nohup`. The passing run kept the sandbox
  exec session alive, then shut it down through `tools/dev/sandbox.sh down`.
  The sandbox directory was removed and both alternate ports were confirmed
  free. No installed-app or foreign sandbox process was touched.
