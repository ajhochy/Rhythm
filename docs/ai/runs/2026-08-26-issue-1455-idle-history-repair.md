---
date: 2026-08-26
repo: Rhythm
branch: fix/bridge-stream-reliability-repair
pr: null
issues: [1455, 1458]
status: ready-for-verification
tags: [run, Rhythm]
---

# Issue #1455 idle-history repair

## Root cause

The fork persisted `step-finish` before its async event conversion published that part. The bridge handled the earlier raw `session.idle` from only its local part accumulator, broadcast the generic #636 error, and cleared the turn IDs before the delayed finish arrived.

## Phase 0 — acceptance contract

- Added the production event order `step-start / known assistant ID → idle → delayed step-finish`, with authoritative `listMessages` data in real SDK `{info, parts}` order/shape.
- Added history-failure/no-reason fallback, single persistence/publication, unchanged nonempty finalization, and next-turn isolation coverage.
- RED command: `cd apps/api_server && npx vitest run src/contract/issue_1455_1456_idle_finalization.test.ts --no-file-parallelism` — **expected failure: 2 failed, 18 passed**. The bridge never called `listMessages`, and a late prior-turn finish classified the next turn as `content-filter`.

## Phase 1 — impact

- GitNexus upstream impact attempts for `_relayEvent`, `OpencodeClientService.listMessages`, and `emptyResponseMessage` returned risk `UNKNOWN`, impacted count 0: LadybugDB index v42 versus connected client v41. No HIGH/CRITICAL result was returned.
- Local caller scope: `_relayEvent` is private to the two stream listeners plus tests; `listMessages` has four existing service callers; `emptyResponseMessage` has one bridge caller. New helpers `lastStepFinishReason` and `resolveEmptyTurnStopReason` are private and called only by the zero-text idle path.

## Files

- `apps/api_server/src/services/opencode_stream_bridge.ts` — serially awaits relay handling, checks cached parts first, performs one fail-soft authoritative history lookup only for zero-text idle without a cached reason, selects by pending assistant IDs (latest assistant only when none exist), clears stale IDs on a new user message, then broadcasts once and clears turn state.
- `apps/api_server/src/contract/issue_1455_1456_idle_finalization.test.ts` — race, fallback, no-duplicate, nonempty, and no-next-turn-leak contracts.
- `docs/ai/contracts/issue-1455.json` — records c7-c9 as passing.
- `docs/ai/contracts/issue-1458.json` — narrows c1 to engine-side wildcard before bridge handling plus real read/bash/edit/no asks; c4 listener-independence remains unchanged; no physical stream-down claim.

## Checks

- GREEN contract: `npx vitest run src/contract/issue_1455_1456_idle_finalization.test.ts --no-file-parallelism` — **20 passed**.
- Initial full API run: `npm test` — **expected repair-loop failure: 1 failed, 5998 passed, 210 skipped**. Legacy #636's mock omitted `listMessages` and asserted immediate fallback publication.
- Repair check: `npx vitest run src/__tests__/issue_636_contract.test.ts src/contract/issue_1455_1456_idle_finalization.test.ts --no-file-parallelism` — **22 passed**. Product now skips the async fallback when the boundary is unavailable, preserving immediate #636 behavior in that fail-soft case.
- Final S2 13-file focused command (the prior 157 baseline plus four additions) — **161 passed, 6 skipped**.
- Final full API suite: `npm test` — **5999 passed, 210 skipped** across 760 files.
- `npm run build` — **PASS** (`tsc -p tsconfig.json` plus postbuild).
- `git diff --check` — **PASS**.
- GitNexus `detect_changes(scope: all)` — attempted and unavailable due to the same v42/v41 mismatch.
- Sandbox/live test — **not run**: S3 owns the sole sandbox. Existing #1455 c5/c6 and narrowed #1458 c1 remain explicitly `UNVERIFIED` for S3's serial live gate.

## Handoff

- Production risk: **LOW**. The new engine read is confined to zero-text idle turns with no cached finish reason; known reasons and every nonempty #1456 persistence/preview/transcript path stay local, and lookup failures retain the exact #636 generic message.
- READY_FOR_VERIFICATION after S3 runs the serial live #1455/#1458 sandbox cases. No push or PR was created.
