---
date: 2026-07-24
repo: Rhythm
branch: codex/1161-1162-profile-fixes
pr: null
issues: [1161]
status: complete
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
- `RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 RHYTHM_LIVE_URL=http://127.0.0.1:4298 DB_PATH=/tmp/rhythm-dev-sandbox-1161-1162/rhythm.db RHYTHM_SANDBOX_HOME=/tmp/rhythm-dev-sandbox-1161-1162/home npx vitest run src/__tests__/live_e2e_1161_cookbook_bound_profile.test.ts src/__tests__/live_e2e_1162_permission_shape_transition.test.ts` — PASS, 2/2 live tests. The real HTTP cookbook run retained the bound profile identity and observable engine behavior.

## Notes

- The branch-built sandbox used API `:4298` and engine `:4297`; the unrelated workflow on `:4098`/`:4097` was not touched.
