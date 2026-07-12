---
date: 2026-07-12
repo: Rhythm
branch: fix/fallback-multi-tier-cascade
pr: null
issues: [930]
status: partial
tags: [run, Rhythm]
---

# Bounded provider fallback cascade

## Files

- Centralized structured provider-error classification and visited-tier walking in `model_fallback.ts`.
- Replaced one-shot handoff state with a per-retained-turn bounded cascade in `turn_redispatch.ts`.
- Routed Anthropic-compatible POSTs and generic structured stream errors through the same transition.
- Retained model/MCP scope and reapplied provider-aware session preparation before every re-prompt.
- Added contract, state-machine, bridge, route, auth, and gated live coverage.

## Checks

- Contract before implementation:
  - `cd apps/api_server && node_modules/.bin/vitest run src/contract/issue_930_fallback_cascade.test.ts`
  - Expected failure: 4 tests failed on classifier, second hop, Gemini prep, and visited-tier assertions.
- Final deterministic API checks:
  - `cd apps/api_server && npx --no-install tsc --noEmit && npm run build && npx --no-install vitest run src/contract/issue_930_fallback_cascade.test.ts src/services/__tests__/model_fallback.test.ts src/services/__tests__/turn_redispatch.test.ts src/__tests__/opencode_stream_bridge.test.ts src/__tests__/opc_m1_4_stream_lifecycle.test.ts src/__tests__/opencode_auth_store.test.ts src/__tests__/live_e2e_930.test.ts`
  - Exit 0: build succeeded; 6 files / 97 tests passed; live file skipped with 3 gated tests.
- Required route suite attempt:
  - `cd apps/api_server && node_modules/.bin/tsc --noEmit && node_modules/.bin/vitest run src/services/__tests__/model_fallback.test.ts src/__tests__/anthropic_session_routing.test.ts src/services/__tests__/turn_redispatch.test.ts src/contract/issue_930_fallback_cascade.test.ts src/__tests__/opencode_stream_bridge.test.ts`
  - Environment failure: four files / 72 tests passed; `anthropic_session_routing.test.ts` could not bind `127.0.0.1` (`listen EPERM`) and its 15 tests were skipped after the hook timeout.
- Workflow issue checks:
  - `ai-workflow checks --level issue`
  - API TypeScript passed. Flutter analyze/format could not write the external Flutter SDK cache (`engine.stamp: Operation not permitted`).
- Workflow PR checks:
  - `ai-workflow checks --level pr`
  - API TypeScript passed; Flutter cache failed as above; full Vitest was terminated after three minutes because listener tests repeatedly waited on the sandbox socket prohibition.
- GitNexus:
  - Current-worktree impact before edits: LOW for fallback/redispatch/input symbols; HIGH for `_relayEvent` (create/resume/fork flows), disclosed before editing.
  - `detect-changes --scope unstaged`: 11 source/test files, 34 symbols, 0 affected execution flows, LOW risk.

## Notes

- Runtime recon found the current fork retry policy is bounded at three attempts; non-Anthropic terminal errors surface through one structured `session.error` shape with status/body/code preserved.
- Local auth-store provider ids (credentials not printed): `anthropic`, `openai`, `google`, `openrouter`, `github-copilot`.
- No checked runtime `.env`, `env.ts`, or CI config sets `AGENT_FALLBACK_CHAIN`; only parser/tests and historical docs reference it.
- Live full-engine verification was not run. This sandbox rejects local socket binding, so the api_server/fork could not be launched and `RHYTHM_LIVE_E2E=1` could not execute. The gated live tests remain `pending` in `docs/ai/contracts/issue-930.json`.
