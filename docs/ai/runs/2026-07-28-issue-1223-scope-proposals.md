---
date: 2026-07-28
repo: Rhythm
branch: mega/proposals-1223
pr: null
issues: [1223]
status: blocked
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

## Files changed

- Added issue #1223 contract and live-test coverage.
- Added MCP server-name resolution shared by proposal generation and validation.
- Updated broaden, tighten, and prune proposal handling, legacy-row invalidation,
  and broaden measurement behavior.

## Checks run

- Failing-first: `npx vitest run src/__tests__/issue_1223_contract.test.ts src/services/generators/__tests__/workflow_signal_generator.test.ts --no-file-parallelism`
  failed 4 assertions (generator retained `gitnexus_query`; grant validation
  accepted it; tighten/prune lacked validators).
- Targeted: `npx vitest run src/__tests__/issue_1223_contract.test.ts src/__tests__/issue_1139_contract.test.ts src/services/generators/__tests__/workflow_signal_generator.test.ts --no-file-parallelism`
  passed 18/18.
- `npx tsc --noEmit` passed.
- `ai-workflow checks --level issue` passed API and MCP TypeScript checks but
  failed because Flutter attempted to write its SDK cache outside the managed
  workspace.
- `npm test` could not complete in the managed environment: socket-based suites
  failed with `listen EPERM`, and the run was stopped after repeated 15-second
  socket timeouts.
- `bun run build --single` failed because the vendored OpenCode workspace
  dependencies were absent. `bun install` could not restore them because
  external package access was denied.

## Notes

- Live verification was not run: the required fresh fork engine binary could
  not be built. No production endpoint, real user database, or ports 4000/4001
  were touched.
- No commit was created because the issue's live verification hard gate remains
  unsatisfied.
