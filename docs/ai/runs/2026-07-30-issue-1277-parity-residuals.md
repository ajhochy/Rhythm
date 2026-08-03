---
date: 2026-07-30
repo: Rhythm
branch: codex/fix-1277-parity-residuals
pr: pending
issues: [1277]
status: complete
tags: [run, Rhythm]
---

# Issue #1277 — mobile parity residuals

## Files

- `apps/api_server/src/mobile_gateway_surface.ts` records the primary local API
  origin on the separate phone-gateway Express surface.
- `apps/api_server/src/controllers/agentWebhookController.ts` uses that origin
  for receive URLs, while direct primary-API requests retain their request
  origin.
- `apps/mobile/tests/msp-006-live-parity.test.mjs` canonicalizes the desktop MCP
  enrichment to the shared engine-status projection and sorts provider-auth
  arrays by stable non-secret display identity.
- `apps/api_server/src/contract/issue_1277_parity_residuals.test.ts` proves two
  separate listeners return the same primary-API webhook receive URL.
- `apps/mobile/tests/contract/issue-1277-parity-residuals.test.mjs` locks MCP
  semantic parity and provider-auth redaction alignment.
- `docs/ai/contracts/issue-1277.json` records the three acceptance criteria.
- `docs/ai/mobile-tools-project-scope-inventory.md` documents why the MCP wire
  shapes intentionally differ.
- `docs/ai/project-state.md` records the current handoff state.

## Checks

### Acceptance red

- `cd apps/api_server && npx vitest run src/contract/issue_1277_parity_residuals.test.ts --reporter=verbose`
  - 1/1 failed as intended: gateway response used the gateway listener port
    instead of the primary API port.
- `cd apps/mobile && node --test tests/contract/issue-1277-parity-residuals.test.mjs`
  - 2/2 acceptance criteria failed as intended: MCP map versus enriched array,
    and provider-auth prompts paired in different orders after `key` redaction.

### Acceptance green and regressions

- `cd apps/api_server && npx vitest run src/contract/issue_1277_parity_residuals.test.ts src/__tests__/issue_1173_webhook_rotation.test.ts --reporter=verbose`
  - 2/2 passed.
- `cd apps/mobile && node --test tests/contract/issue-1277-parity-residuals.test.mjs`
  - 2/2 acceptance criteria passed; the env-gated live test skipped normally.
- `cd apps/api_server && npm run build`
  - passed.
- `cd apps/api_server && npm test -- --reporter=dot`
  - 3,779 passed / 119 skipped / 0 failed.
- `cd apps/mobile && npm run test:ci:static`
  - passed, including lint, typecheck, static contracts, and security suites.
- `cd apps/mobile && npm test -- --runInBand`
  - 4/4 Jest tests passed.
- `VITEST_MAX_WORKERS=4 PLAYWRIGHT_WEB_PORT=19477
  PLAYWRIGHT_FAKE_PORT=44477 ai-workflow checks --level pr`
  - All configured non-API stages passed after installing the fresh worktree's
    locked MCP-server and fork dependencies: Flutter analyze/format/tests, API
    typecheck/build/lint, MCP typecheck/vitest/build, fork typecheck/session
    tests, mobile static/contract/fake-server, and mobile web E2E.
  - Run 1 exposed unrelated `agent_sessions.test.ts` shared-state drift; its
    immediate isolated rerun passed 48/48.
  - Run 2 exposed a different unrelated `agent_configs_routes.test.ts`
    shared-state drift; its immediate isolated rerun passed 42/42.
  - The wrapper's exact API command,
    `npm test --silent -- --fileParallelism=false`, then passed 3,779 tests /
    119 skipped / 0 failed.
  - The failure-triage result is non-reproducible cross-file state leakage in
    the aggregate wrapper, not a stable failure in either file or this change.

### Live behavioral gate

Before, on API `42298`, engine `42297`, and gateway `42299`:

- 11/14 feeds matched.
- Drifts: `/agent-webhooks`, `/opencode/mcp`, `/provider/auth`.

After:

```bash
RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-parity-1277-after \
RHYTHM_SANDBOX_API_PORT=42398 \
RHYTHM_SANDBOX_ENGINE_PORT=42397 \
RHYTHM_SANDBOX_GATEWAY_PORT=42399 \
RHYTHM_PARITY_FAKE_CLOUD_PORT=46399 \
RHYTHM_SANDBOX_ENGINE_DIR=/Users/ajhochhalter/Documents/Rhythm/.worktrees/issue-1281/apps/opencode_fork/packages/opencode \
RHYTHM_PARITY_EVIDENCE_DIR=/Users/ajhochhalter/Documents/Rhythm/.worktrees/fix-1277/.agent-stack/evidence/issue-1277-after \
tools/dev/parity-gate.sh
```

- 14/14 feeds matched; live test 1/1 passed in 15.1 seconds.
- All three former residuals printed `parity ok`.
- Sandbox cleanup removed the isolated directory; ports `42397`, `42398`,
  `42399`, and `46399` had no remaining listeners.

## Notes

- The provider-auth security scrubber was not changed.
- No production process, live database, push, merge, release, or TestFlight
  action occurred.
- GitNexus pre-edit impact marked the three existing helpers CRITICAL due to
  broad import-graph expansion. Direct callers remained four webhook response
  paths and one parity loop; the focused and live gates cover those paths.
