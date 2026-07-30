---
date: 2026-07-30
repo: Rhythm
branch: codex/msp-006-project-scoped-tools
pr: null
issues: [MSP-006]
status: verification-blocked
tags: [run, Rhythm, mobile, tools, project-scope]
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
