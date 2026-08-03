---
date: 2026-08-01
repo: Rhythm
branch: codex/mobile-fixes-rollup
pr: 1284
issues: [1285, 1287]
status: in_progress
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# Issue #1285 projectless mobile-send synchronization

## Files changed

- Relaxed only the project predicate for exact-owner projectless session-state updates.
- Started and awaited the API event bridge before forwarding a sanitized mobile `prompt_async` request.
- Removed the mobile title path that incorrectly invoked OpenCode context compaction.
- Filtered internal compaction turns and added bounded post-prompt assistant polling.
- Added c16-c20 contracts, focused API/mobile tests, a real isolated gateway regression, recon evidence, and failure postmortems.

## Checks run

- `npx vitest run src/__tests__/issue_1169_mobile_opencode_proxy.test.ts src/__tests__/issue_1285_mobile_prompt_stream.test.ts src/__tests__/issue_1285_projectless_session_state.test.ts --fileParallelism=false` — PASS, 3 files / 16 tests.
- `npm run build` in `apps/api_server` — PASS.
- `npx tsc --noEmit` in `apps/mobile` — PASS.
- `bun run build --single` in the vendored fork — PASS; standalone binary smoke passed.
- Isolated sandbox on API 4098 / engine 4097 plus `RHYTHM_LIVE_E2E=1 ... npx vitest run src/__tests__/issue_1279_mobile_gateway_live.test.ts --fileParallelism=false` — PASS, 1/1 in 3.51 seconds.
- `ai-workflow checks --level issue` — PASS.
- Final `ai-workflow checks --level pr` — PASS for every configured stage.
- Desktop runtime probes `GET /health` and `GET /opencode/health` on port 4001 — HTTP 200.
- GitNexus `detect-changes --scope unstaged` — MEDIUM, 10 files / 14 symbols / 3 expected flows.

## Notes

Manual smoke showed four independent gaps: title generation invoked compaction;
internal compaction records rendered as chat; an API restart left no engine event
bridge for mobile-originated turns; and the mobile client refreshed before
`prompt_async` completed. Direct engine inspection proved the agent had answered
even though neither client converged.

Failure triage also found two environment/test issues. The fork build required
its documented `models.dev` input, and an old proxy fixture needed an explicit
no-op stream dependency. One unchanged fork interruption test timed out once,
then passed focused and in the final full matrix. Follow-up remains #1287; no
duplicate issue was opened.
