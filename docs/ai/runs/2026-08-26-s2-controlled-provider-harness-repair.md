---
date: 2026-08-26
repo: Rhythm
branch: fix/bridge-stream-reliability-repair
pr: null
issues: [1455, 1456]
status: unverified
tags: [run, Rhythm]
---

# S2 controlled-provider harness repair

## Files

- `apps/api_server/src/__tests__/issue_1455_1456_idle_finalization_live_e2e.test.ts`
- `apps/api_server/src/contract/issue_1455_1456_idle_finalization.test.ts`
- `docs/ai/contracts/issue-1455.json`
- `docs/ai/contracts/issue-1456.json`
- This run note
- Production-source diff: empty. No production source was modified.

## Acceptance contract

- Initial command: `npx vitest run src/contract/issue_1455_1456_idle_finalization.test.ts --no-file-parallelism`
- Initial result: expected FAIL — 14 passed, 2 failed. Both new harness contracts caught the missing temporary profile/model binding; #1456 also caught its missing independent fixture provider.
- Repaired result: PASS — 16/16.
- Regression caught: either live case drifting back to `agentId: null`, omitting its controlled provider/model override, or dropping the engine-message binding assertion fails its issue-specific harness contract.

## Checks

- `npx vitest run src/contract/issue_1455_1456_idle_finalization.test.ts src/__tests__/issue_1455_1456_idle_finalization_live_e2e.test.ts --no-file-parallelism` — PASS, 16 passed / 2 live skipped.
- `npx vitest run src/__tests__/issue_1455_1456_idle_finalization_live_e2e.test.ts --no-file-parallelism` — PASS, 2 skipped under the normal env gate.
- `env -u RHYTHM_LIVE_E2E_ISOLATED -u RHYTHM_LIVE_DB_PATH -u DB_PATH RHYTHM_LIVE_E2E=1 npx vitest run src/__tests__/issue_1455_1456_idle_finalization_live_e2e.test.ts --no-file-parallelism` — expected FAIL CLOSED before either test; isolation guard reported missing `RHYTHM_LIVE_E2E_ISOLATED=1` and DB path.
- `node_modules/.bin/tsc --noEmit` — PASS.
- `npm run build` — PASS, including postbuild.
- GitNexus impact/context was attempted for the test file and `refusalStream`; unavailable because the local LadybugDB index is storage version 42 while the connected build expects 41. No production/shared symbol was edited.

## Live handoff

S3 owns the sole sandbox, so no server was started and the live gate remains **UNVERIFIED**. After S3 releases it, run the entire file once (never `-t '#1456'`):

```bash
RHYTHM_LIVE_E2E=1 \
RHYTHM_LIVE_E2E_ISOLATED=1 \
RHYTHM_LIVE_URL=http://127.0.0.1:4098 \
RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:4097 \
  npx vitest run src/__tests__/issue_1455_1456_idle_finalization_live_e2e.test.ts \
  --no-file-parallelism
```

Each case owns a unique Anthropic-compatible provider and temporary agent profile. Immediately after WebSocket input, each polls the real engine message list and asserts the user message model exactly equals `{ providerID: providerId, modelID: modelId }` before checking #1455 refusal semantics or #1456 append/persistence/preview/no-duplicate behavior. Cleanup order is WebSocket, Rhythm session while provider is reachable, profile, original global config + refresh, then provider.
