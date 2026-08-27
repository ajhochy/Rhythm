---
date: 2026-08-26
repo: Rhythm
branch: fix/bridge-stream-reliability-repair
pr: pending
issues: [688, 1186, 1322, 1457]
status: ready_for_verification
tags: [run, Rhythm]
---

# S2 PR-gate test-only repair

## Scope

- Worktree: `/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/rhythm-s2-verify`
- Starting HEAD: `63ab218b1601393de7db3ffcd9f50e8630064783`
- Test and evidence changes only; no production source changed.
- S4 owns the sandbox. No server, sandbox, port, or live-test command was run.

## Phase 0 — acceptance evidence

- Env-unset focused command before repair: `env -u RHYTHM_LOCAL_RENDERER_ORIGINS -u RHYTHM_LIVE_E2E -u RHYTHM_LIVE_E2E_ISOLATED -u RHYTHM_LIVE_DB_PATH -u DB_PATH npx vitest run src/services/opencode_client_service.test.ts src/__tests__/opc_m1_4_stream_lifecycle.test.ts src/__tests__/issue_1186_sandbox_foreground.test.ts --no-file-parallelism` — expected failure: **3 failed, 81 passed**. Failures were the stale bypass-permission expectation, global `setTimeout` count, and fabricated PID assertion.
- Inherited-env CORS reproduction before repair: `RHYTHM_LOCAL_RENDERER_ORIGINS='rhythm://ambient' npx vitest run src/services/opencode_client_service.test.ts -t 'host supplied none'` — expected failure: **1 failed, 59 skipped** because `undefined` selected the ambient default.

## Phase 1 — impact

- GitNexus upstream impact was attempted for all three test files before editing. Each returned risk `UNKNOWN`, impacted count 0, because the index is LadybugDB v42 while the connected client expects v41; no HIGH/CRITICAL result was returned.

## Files

- `apps/api_server/src/services/opencode_client_service.test.ts` — isolates the no-host CORS input, keeps ordinary modes permission-free, and asserts the exact bypass wildcard allow rule separately.
- `apps/api_server/src/__tests__/opc_m1_4_stream_lifecycle.test.ts` — removes the brittle global timer count while retaining error durability after timer advancement and the unrelated `pty_runner` source guard.
- `apps/api_server/src/__tests__/issue_1186_sandbox_foreground.test.ts` — uses distinct real listener/recorded processes and proves the exact refusal names both PIDs while preserving both processes.
- This run note.

## Checks

- Repaired env-unset focused command — **PASS: 84 passed** across 3 files. The first repair run exposed an inaccurate expected word in the exact refusal text; the assertion was corrected and rerun green.
- Inherited-env CORS regression command — **PASS: 1 passed, 60 skipped**.
- Full env-unset `npm test` — **PASS: 5995 passed, 210 skipped** across 760 files; none of the four triaged failures remained.
- S2 focused 13-file suite — **PASS: 157 passed, 6 skipped**.
- `node_modules/.bin/tsc --noEmit` — **PASS**.
- `npm run build` — **PASS**, including postbuild.
- `git diff --check` — **PASS**.
- Production-source diff command: `git diff --name-only -- apps/api_server/src ':!apps/api_server/src/__tests__' ':!apps/api_server/src/contract' ':!apps/api_server/src/services/*.test.ts'` — **PASS**, no output.
- GitNexus `detect_changes(scope: all)` was attempted before commit and was unavailable due to the same LadybugDB v42/client v41 mismatch.

## Handoff

- READY_FOR_VERIFICATION for S4's final serial live gate. This run makes no live-gate pass claim.
