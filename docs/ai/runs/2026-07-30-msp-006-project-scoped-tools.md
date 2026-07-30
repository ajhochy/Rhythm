---
date: 2026-07-30
repo: Rhythm
branch: codex/msp-006-project-scoped-tools
pr: 1262
issues: [MSP-006]
status: awaiting-playwright
tags: [run, Rhythm, mobile, tools, project-scope]
index: "[[Rhythm]]"
---

# MSP-006 project-scoped mobile Tools

## Files

- Resumed the preserved mobile Tools/provider/service implementation without
  reverting or recreating it.
- Completed the inventory and acceptance-contract audit.
- Corrected the issue-1173 resilient-state expectation and enabled explicit
  TypeScript extension imports for the shared request helper.

## Checks

- `cd apps/mobile && node --test tests/msp-006-project-scoped-tools.test.mjs`
  — 8 passed, 0 failed.
- `cd apps/mobile && node --test
  tests/contract/issue-1173-completeness-audit.test.mjs
  tests/issue-1173-tools-service.test.mjs` — 11 passed, 0 failed after
  correcting the inherited old-state expectation.
- Wider dependency-light Node attempt (38 files; live parity excluded) —
  75 passed, 20 failed: 19 environment/dependency/network/listener failures
  and one pre-existing unrelated `issue-1173-c18` assertion.
- `cd apps/mobile && npx tsc --noEmit` — did not reach compilation:
  `npx` attempted a registry lookup because `apps/mobile/node_modules` is
  absent, then failed `ENOTFOUND` under restricted networking.

## Notes

- `apps/mobile/tests/msp-006-live-parity.test.mjs` was written and inspected
  but not executed, per MSP-006 safety requirements.
- No sandbox helper, API server, engine, installed database, or production
  system was started or touched.
- GitNexus impact/detect tooling was attempted through the repo helper but
  could not resolve its unavailable registry package in this environment.

## Repair pass

### Files changed

- `apps/mobile/lib/runtime/mobile-runtime.e2e.ts`
- `apps/mobile/providers/rhythm-tools-provider.tsx`
- `apps/mobile/providers/services/rhythm-tools-service.ts`
- `apps/mobile/tests/msp-006-project-scoped-tools.test.mjs`

### Checks run

- `cd apps/mobile && ./node_modules/.bin/tsc --noEmit` — passed.
- `cd apps/mobile && npm run lint` — passed.
- `cd apps/mobile && node --test
  tests/msp-006-project-scoped-tools.test.mjs
  tests/contract/issue-1173-completeness-audit.test.mjs
  tests/issue-1173-tools-service.test.mjs` — 19 passed, 0 failed
  (MSP-006 8/8; issue-1173 11/11).

### Notes

- Every saved Playwright error context in `apps/mobile/test-results/` (25/25)
  showed the same `Pair this iPhone again` state after a Tools route opened.
  Representative examples are the issue-1234 Brain data case,
  issue-1173-c15 Scheduled Jobs, issue-1232 Scheduled Jobs deep link, and
  issue-1235 compact tool header.
- Root cause: `AppRhythmToolsProvider` let the intentionally unpaired E2E
  browser runtime resolve to `unauthorized-pairing` before honoring the
  E2E transport. It also replaced the E2E service's fake project ID with the
  direct OpenCode worktree path.
- The repair keeps missing scope fail-closed, retains the E2E runtime's
  registered `project-demo` scope after an active project exists, and
  preserves the fake server's structured `EXPIRED_AUTH` code so auth expiry
  remains distinct from revoked device pairing.
- The Playwright foundation suite was not run in this sandbox, per the repair
  task constraint. PR #1262 still requires the orchestrator's rerun.
- GitNexus impact/detect remained unavailable: no MCP tool, repo runner, or
  installed CLI was available. Structural reference tracing found one
  production composition site for `AppRhythmToolsProvider`.
- Commit/push was blocked because the sandbox cannot create the worktree index
  lock under the shared Git directory outside the writable root. The intended
  changes remain unstaged; pre-existing `.proof` PNG modifications were not
  touched.
