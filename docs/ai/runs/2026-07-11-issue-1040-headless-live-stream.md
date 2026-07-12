---
date: 2026-07-11
repo: Rhythm
branch: uso/agent-followups
pr: null
issues: [1040]
status: implemented-verification-blocked
tags: [run, Rhythm]
---

# Issue #1040 — headless live stream

## Files

- `apps/api_server/src/services/agent_runner.ts` — registers the SDK→Rhythm
  mapping, starts the directory-scoped shared stream bridge, and upserts the
  blocking prompt result by SDK message id.
- `apps/api_server/src/__tests__/issue_1040_agent_runner_streaming.test.ts` —
  contract coverage for `effectiveCwd` subscription/mapping and output dedupe.
- `docs/ai/contracts/issue-1040.json` — two automated criteria plus the
  explicitly deferred live scheduled-run check.
- `docs/ai/decisions/2026-07-11-1040-headless-stream-dedupe.md` — records the
  idempotent completion-write choice.

## Checks

- `cd apps/api_server && npx tsc --noEmit` — PASS (exit 0, no output).
- `cd apps/api_server && npx vitest run src/__tests__/issue_738_agent_runner.test.ts src/__tests__/issue_738_fix_model_and_session.test.ts src/__tests__/issue_1040_agent_runner_streaming.test.ts`
  — PASS: 3 files, 26 tests.
- `cd apps/api_server && npx vitest run` — BLOCKED by the managed sandbox and
  stopped after widespread unrelated HTTP timeouts. Isolated repro:
  `npx vitest run src/__tests__/helpers/real_server.test.ts --reporter=verbose`
  → 3/3 fail with `listen EPERM: operation not permitted 0.0.0.0` at
  `startTestServer`; this environment cannot bind ephemeral test ports.
- Live scheduled-run smoke — NOT RUN. The owner explicitly required preserving
  the already-running app on :4001/:4096 and prohibited spawning a backend or
  engine.

## Notes

- The bridge has no required WS-client instance coupling. Its broadcasts are
  best-effort through the existing gateway singleton; persistence works with no
  chat client connected.
- The bridge routes engine events through `opencodeSessionMap`, so AgentRunner
  now registers the mapping before subscribing.
- GitNexus MCP impact/detect tools were unavailable; the package fallback also
  failed DNS. Static inspection found `_runOnce` has one caller (`run`) and this
  change adds one caller of the unchanged `streamSession` method.
