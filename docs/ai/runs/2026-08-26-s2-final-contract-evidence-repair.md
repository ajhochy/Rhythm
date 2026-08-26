---
date: 2026-08-26
repo: Rhythm
branch: fix/bridge-stream-reliability-repair
pr: pending
issues: [1455, 1456, 1458]
status: ready_for_verification
tags: [run, Rhythm]
---

# S2 final contract-evidence repair

## Phase 0

WAIVED: test/contract-evidence-only repair with no production behavior change; verification is focused unit contracts, live-file skip/fail-closed gates, TypeScript/build, and production-source diff inspection.

## Scope

- Worktree: `/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/rhythm-s2-verify`
- Starting HEAD: `3cd25f78c7443a478fc744d0c434f03d4666cac4`
- S3 owns the sole sandbox; this run does not start servers or touch ports.

## Phase 1 — impact

- GitNexus impact analysis waived per dispatch because every permitted edit is a test, contract JSON, or run log; no production symbol or shared production path is edited.
- Known GitNexus v42 index / v41 client mismatch remains unchanged.

## Files

- `apps/api_server/src/__tests__/issue_1455_1456_idle_finalization_live_e2e.test.ts`
  - #1456 attaches the session-scoped, role-output `transcript.append` waiter before input, then independently polls one structured persisted output and idle preview.
  - #1455 uses a temporary Anthropic-compatible refusal provider and proves the actionable content-filter error plus the single zero-text persisted finish.
- `apps/api_server/src/__tests__/issue_1458_bypass_engine_permission_live_e2e.test.ts`
  - Controlled provider now drives the real built-in `read`, `bash`, and `edit` tools in sequence before final text.
  - Asserts completed tool history, output/file markers, wildcard permission storage, and zero asks; it never calls the direct shell route.
- `apps/api_server/src/contract/issue_1455_1456_idle_finalization.test.ts` — parameterized both absent and literal `unknown` #636 fallback reasons.
- `docs/ai/contracts/issue-{1455,1456,1458}.json` — separate #1455/#1456 commands and honest pending-live evidence. #1458 c1 remains `UNVERIFIED`.
- This run note.

## Checks

- Focused unit contracts:
  `npx vitest run src/contract/issue_1455_1456_idle_finalization.test.ts src/contract/issue_1458_bypass_engine_permission.test.ts src/__tests__/agent_sessions.test.ts -t '#1458|issue-1455|issue-1456'`
  — **PASS: 22 passed, 48 skipped** across 3 files.
- Live files, normal invocation:
  `npx vitest run src/__tests__/issue_1455_1456_idle_finalization_live_e2e.test.ts src/__tests__/issue_1458_bypass_engine_permission_live_e2e.test.ts`
  — **PASS/SKIP: 3 skipped** across 2 files.
- Fail-closed probe:
  `RHYTHM_LIVE_E2E=1 npx vitest run src/__tests__/issue_1455_1456_idle_finalization_live_e2e.test.ts src/__tests__/issue_1458_bypass_engine_permission_live_e2e.test.ts`
  — **expected nonzero**; both suites stopped in `assertLiveE2EIsolation` because isolation was absent, before network or provider setup.
- All S2 focused suite (13 files, aggregate command from `2026-08-26-bridge-restart-engine-harness.md`) — **PASS: 155 passed, 6 skipped**.
- `node_modules/.bin/tsc --noEmit` — first run found a test-only `WebSocket.RawData` type reference; repaired with the exported `RawData` type, second run **PASS** with no output.
- `npm run build` — **PASS** (`tsc -p tsconfig.json` plus advisory-copy postbuild).
- `git diff --check` — **PASS**.
- Production-source diff check:
  `git diff --name-only -- apps/api_server/src ':!apps/api_server/src/__tests__' ':!apps/api_server/src/contract'`
  — **PASS**, no output.
- GitNexus `detect_changes(scope: all)` was attempted before commit and remained unavailable because the index is v42 while the connected LadybugDB client is v41.

## Notes

- No sandbox/server/port command was run. S3 retains sole sandbox ownership.
- #1455 live case now covers provider `refusal` → `content-filter`, the exact structured error, start-new-session guidance, one persisted output with `step-finish`, and no nonempty assistant text.
- #1456 live case now separately proves the synchronized WS append, one structured persisted assistant row with non-null SDK message ID, marker text part, idle preview, and no duplicate legacy output.
- #1458 live case now covers real external `read`, project-cwd `bash`, project-file `edit`, final provider text, completed history outputs/file state, no asks, and stored `*`/`*`/`allow`.
- #1458 c1 remains `UNVERIFIED` until S3 runs the strengthened live case. This harness does not claim the global event stream was physically stopped; it only preserves the already observed external-read/no-ask evidence for c2 and the existing unit evidence for c3/c4.
- Ready for S3's final serial live rerun.
