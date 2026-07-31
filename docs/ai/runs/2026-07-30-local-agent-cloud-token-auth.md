---
date: 2026-07-30
repo: Rhythm
branch: codex/fix-local-agent-cloud-token-auth
pr: null
issues: []
status: implemented-live-pending
tags: [run, Rhythm]
---

# Local agent Cloud token authentication

## Files

- `apps/api_server/src/middleware/auth_middleware.ts`
  - On an `AGENT_LOCAL` Bearer miss, delegates to the shipped
    `MobileCloudIdentityService.authenticateBearerToken`.
  - Adds a SHA-256-keyed positive cache (5-minute TTL, 256 entries,
    oldest-entry eviction) and per-token in-flight coalescing.
- `apps/api_server/src/routes/agent_sessions_routes.ts`
  - Rejects authenticated cross-owner access to an individual owned session
    without changing tokenless access.
- `apps/api_server/src/contract/local_agent_cloud_token_auth.test.ts`
  - Real Express router/error-boundary contract with only Cloud fetch,
    OpenCode, and unrelated file-backed account storage faked.
- `apps/api_server/src/__tests__/local_agent_cloud_token_auth_live_e2e.test.ts`
  - Env-gated real API/engine desktop request sequence; written but not run.
- `docs/ai/contracts/local-agent-cloud-token-auth.json`
  - Eleven acceptance criteria; c1-c10 pass, c11 remains pending until the
    explicitly deferred live run.

## Checks

- RED on unmodified implementation:
  - `cd apps/api_server && npx vitest run src/contract/local_agent_cloud_token_auth.test.ts`
  - 1 file failed; 8 tests failed, 2 passed. Expected failures were the
    local-only 401 path, absent Cloud calls, unavailable-Cloud 401 instead of
    503, and missing cross-user isolation.
- GREEN after implementation:
  - `cd apps/api_server && npx vitest run src/contract/local_agent_cloud_token_auth.test.ts`
  - 1 file passed; 10 tests passed.
- TypeScript:
  - `cd apps/api_server && npx tsc --noEmit`
  - Exit 0.
- Non-socket regressions:
  - `cd apps/api_server && npx vitest run src/services/__tests__/mobile_cloud_identity_service.test.ts src/contract/issue_1231_session_catalog_sync.test.ts src/__tests__/issue_1231_reconcile_failure_contract.test.ts`
  - 3 files passed; 13 tests passed.
  - `cd apps/api_server && npx vitest run src/contract/issue_1230_cloud_identity_binding.test.ts -t 'numeric collision|mismatched immutable identity|valid immutable bindings'`
  - 1 file passed; 3 tests passed, 1 skipped.
- Legacy socket-bound aggregate:
  - `cd apps/api_server && npx vitest run src/contract/local_agent_cloud_token_auth.test.ts src/services/__tests__/mobile_cloud_identity_service.test.ts src/contract/issue_1230_cloud_identity_binding.test.ts src/contract/issue_1231_session_catalog_sync.test.ts src/__tests__/issue_1231_reconcile_failure_contract.test.ts src/__tests__/opc_agent_session_routes.test.ts src/__tests__/agent_local_auth_bypass.test.ts src/__tests__/agent_sessions.test.ts`
  - Environment-blocked and stopped after existing `listen(0)` helpers failed
    with `EPERM: operation not permitted`; no changed-code assertion failure
    was observed.
- `git diff --check`
  - Exit 0.
- GitNexus:
  - `gitnexus detect-changes --scope all`
  - LOW risk; 3 tracked files, 6 mapped symbols, 0 affected processes.
  - `gitnexus detect-changes --scope compare --base-ref origin/main`
  - LOW risk; 3 tracked files, 6 mapped symbols, 0 affected processes.
  - The required local-`main` comparison reported HIGH across 1,025 files
    because local `main` is stale; `origin/main` is the actual branch base.
- Repo-wide issue check:
  - `ai-workflow checks --level issue`
  - Reproduced environment failure twice. API `tsc --noEmit` passes; Flutter
    cannot update its external SDK cache (`engine.stamp: Operation not
    permitted`), and `apps/mcp_server` has no installed `tsc` while registry
    network access is unavailable.

## Live command (documented, not run)

Per the task safety policy, no server or sandbox was started and this command
was not executed:

```bash
cd apps/api_server
RHYTHM_LIVE_E2E=1 \
RHYTHM_LIVE_E2E_ISOLATED=1 \
RHYTHM_LIVE_URL=http://127.0.0.1:4098 \
RHYTHM_LIVE_DB_PATH=/tmp/<isolated-run>/rhythm.db \
RHYTHM_LIVE_SERVER_LOG=/tmp/<isolated-run>/api_server.log \
RHYTHM_LIVE_CLOUD_TOKEN='<cloud bearer absent from copied local sessions>' \
RHYTHM_LIVE_PROJECT_CWD=/tmp/<isolated-run>/project \
npx vitest run src/__tests__/local_agent_cloud_token_auth_live_e2e.test.ts
```

## Notes

- Tokenless `AGENT_LOCAL` behavior is unchanged and covered by c10.
- Negative and unavailable Cloud results are never cached.
- Neither logs nor cache keys contain the raw token; cache keys are full
  SHA-256 digests.
- No installed database, keychain, production service, or fixed local agent
  port was touched.
