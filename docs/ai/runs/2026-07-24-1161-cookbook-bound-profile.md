---
date: 2026-07-24
repo: Rhythm
branch: codex/1161-1162-profile-fixes
pr: null
issues: [1161]
status: partial
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

## Files changed

- `apps/api_server/src/controllers/agentCookbookController.ts` — validates a bound profile and forwards its runtime and recorded-session identities.
- `apps/api_server/src/__tests__/issue_740_cookbook_run.test.ts` — bound, unbound, and deleted-binding regressions.
- `apps/api_server/src/__tests__/live_e2e_1161_cookbook_bound_profile.test.ts` — real HTTP/engine behavioral contract.
- `docs/ai/contracts/issue-1161.json` — four-criterion acceptance contract.

## Checks run

- Pre-implementation: `npx vitest run src/__tests__/issue_740_cookbook_run.test.ts` — 3 expected failures, 4 passes.
- `npx vitest run src/__tests__/issue_740_cookbook_run.test.ts src/__tests__/live_e2e_1161_cookbook_bound_profile.test.ts` — 7 passed, 1 env-gated live test skipped.
- `node_modules/.bin/tsc --noEmit` — exit 0.
- `ai-workflow checks --level issue` — exit 0 after worktree-local `apps/mcp_server/npm ci`.

## Notes

- The live behavioral command was not run because another workflow owns sandbox ports 4097/4098. Contract criterion `issue-1161-c4` remains `pending`.
- No server or sandbox was started or stopped.
