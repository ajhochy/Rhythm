---
date: 2026-07-24
repo: Rhythm
branch: codex/1164-agent-run-scheduler
pr: null
issues: [1164]
status: partial
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

## Notes

- GitNexus impact before edits: LOW for `streamLimiter`, `LLM.stream`,
  `TaskTool.run`, and `Config.Info`; no affected indexed execution process.
- The fork subtree's older MCP-only editing boundary is intentionally
  overridden by issue #1164, which explicitly requires changes in `llm.ts`
  and `task.ts`. The divergence is isolated and documented.
- Live criterion `issue-1164-c10` remains pending. Required coordinator run:

  ```bash
  RHYTHM_LIVE_E2E=1 \
  RHYTHM_LIVE_E2E_ISOLATED=1 \
  RHYTHM_LIVE_URL=http://127.0.0.1:4098 \
  RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:4097 \
  DB_PATH=/path/from/sandbox/status/rhythm.db \
  npx vitest run src/__tests__/live_e2e_1164_fifty_reader_swarm.test.ts
  ```

- No server or sandbox process was started or stopped in this worktree.
