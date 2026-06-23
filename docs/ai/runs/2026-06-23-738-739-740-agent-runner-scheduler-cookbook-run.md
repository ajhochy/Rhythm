---
date: 2026-06-23
repo: Rhythm
branch: feature/agent-scheduler
pr: "734"
issues: [738, 739, 740]
status: verified
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

## Files changed

### New files
- `apps/api_server/src/services/agent_runner.ts` — AgentRunner service: `run()` with concurrency cap (`MAX_CONCURRENT_AGENT_RUNS`, default 3), per-run timeout (`AGENT_RUN_TIMEOUT_MS`, default 600 s), `promptAsync` + `listMessages` polling loop, `outputTarget` delivery enum, `_activeRunCount()` exported for test inspection
- `apps/api_server/src/__tests__/issue_738_agent_runner.test.ts` — 7 tests (success, timeout+abort, slot released×2, session fail, promptAsync fail, concurrency cap)
- `apps/api_server/src/__tests__/issue_739_scheduler_agent_runner.test.ts` — 4 tests (AGENT_LOCAL=true calls AgentRunner, AGENT_LOCAL=false calls insertScheduledTrigger, one failure doesn't stop loop, no tasks → no calls)
- `apps/api_server/src/__tests__/issue_740_cookbook_run.test.ts` — 4 tests (runs recipe + returns sessionId, 404 unknown id, prompt built from description+steps, 401 unauthenticated)

### Modified files
- `apps/api_server/src/services/agentSchedulerService.ts` — added `import * as AgentRunner`; added AGENT_LOCAL branch in `checkDueTasks()` that calls `AgentRunner.run()` fire-and-forget (no double-trigger insert) then updates last_run_status; production path unchanged
- `apps/api_server/src/controllers/agentCookbookController.ts` — added `runRecipe()` handler + `_compileStepsToPrompt()` helper (description + numbered steps → prompt string)
- `apps/api_server/src/routes/agentCookbookRoutes.ts` — added `POST /:id/run` → `controller.runRecipe`

## Checks run

| Check | Result |
|---|---|
| `tsc --noEmit` | PASS — 0 errors |
| `npm test` (vitest, full suite) | PASS — 951/951 (111 test files; +15 new) |

## Notes

### Key design decisions
- **Polling over SSE subscription** — AgentRunner uses `listMessages()` polling (500 ms interval) rather than subscribing to the SSE event stream. Rationale: background runners don't have a live HTTP connection to stream from; polling is simpler and correct for fire-and-forget contexts. See `docs/ai/decisions/2026-06-23-agent-runner-polling-vs-sse.md`.
- **Env vars read per-call** — `MAX_CONCURRENT_AGENT_RUNS` and `AGENT_RUN_TIMEOUT_MS` are read inside `run()` (not cached at module init) so tests can override via `process.env` without module cache resets.
- **Fire-and-forget local path** — AgentRunner.run() is called with `.then().catch()` in the scheduler so one task's failure never blocks the loop; `last_run_status` is updated asynchronously.
- **AGENT_LOCAL gating** — reads `env.agentLocal` (`process.env.AGENT_LOCAL === 'true'`) at runtime per task; scheduler tests spy on `env.agentLocal` getter to avoid module cache issues.

### Deviations from spec
- None. All acceptance criteria met headlessly.

### Follow-up
- Flutter "Run" button for cookbook (#740 Flutter half) — separate task, not in this run.
- `notification` outputTarget is a TODO stub in agent_runner.ts — no notification endpoint shape finalized yet.
