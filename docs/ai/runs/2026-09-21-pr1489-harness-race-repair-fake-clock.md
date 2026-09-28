---
date: 2026-09-21
repo: Rhythm
branch: mega/2026-09-18-mobile-electron-hermes
pr: null
issues: []
status: done
tags: [run, Rhythm]
---

## Files

- `apps/api_server/src/contract/pr_1489_harness_race_repair.test.ts` — made two tests deterministic with a fake clock (`vi.useFakeTimers()` / `vi.advanceTimersByTimeAsync()`); no other file touched.

## Checks

- `npx vitest run src/contract/pr_1489_harness_race_repair.test.ts` — 13/13 passed, run 10x consecutively in isolation, all green.
- `npx vitest run` (full `apps/api_server` suite, default parallelism) — 663 files / 6196 tests passed, 0 failed (this doubles as the "under load" run).
- `npx tsc --noEmit -p tsconfig.json` — clean.
- Mutation verification on `waitForBroadRowsToSettle` (`apps/api_server/src/__tests__/_s4_harness_rows.ts`), each reverted immediately after:
  1. Return on first stable read, ignoring `stableMs` → `pr-1489-absolute-c2` failed (`expected 1 to be greater than or equal to 6`).
  2. Drop the deadline check (`while (true)`) → `bounds non-settlement errors...` failed via test timeout (helper never terminates without the deadline).
  - Helper file confirmed byte-identical to original after both reverts (`git status --short` shows only the test file modified).

## Notes

Root cause (already diagnosed, not re-derived here): three tests in this file asserted on real wall-clock deadlines/lap-counts against real `setTimeout`, so suite load (or ~1-in-3 odds even unloaded) flipped the assertions.

Fix used **option 1** from the task brief — `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync()` — for the two genuinely timing-sensitive tests:
- `pr-1489-absolute-c2: requires one continuous stable window...` (`intervalMs: 1, stableMs: 5, timeoutMs: 100`, asserts `waits >= 6`).
- `bounds non-settlement errors to the exact latest row-field diff` (`timeoutMs: 3`).

`vi.useFakeTimers()` fakes `Date` and timers together, so `Date.now()` inside `waitForBroadRowsToSettle` and the test's injected `sleep` (which does a real `setTimeout(resolve, 1)`) advance in lockstep — deterministic regardless of how long a real lap would take under load. `afterEach` now also calls `vi.useRealTimers()` so fake timers never bleed into later tests.

The third test named in the brief (`'waits through one late stream update...'`) was inspected and left untouched — its injected `sleep` does no real waiting (no `setTimeout`), and `stableMs` defaults to `intervalMs: 0`, so `Date.now() - stableSince >= stableMs` is always true; it was never timing-sensitive.

Did **not** touch the helper (`_s4_harness_rows.ts`) — option 1 (fake timers) was sufficient; no need for an injectable `now?: () => number` seam (option 2). Zero product-code risk: the file has exactly one other caller (`live_e2e_1480_1481_1483_1484.test.ts`, unrelated, untouched).

Per task instructions: did not open a PR, did not merge, and pulled/rebased onto the latest `mega/2026-09-18-mobile-electron-hermes` immediately before push (another agent is actively pushing scheduler-wake-gate changes to that branch; no file overlap was found).
