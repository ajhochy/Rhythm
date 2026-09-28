---
date: 2026-09-19
repo: Rhythm
branch: mega/2026-09-18-mobile-electron-hermes
pr: 1544
issues: []
status: pass
tags: [run, rhythm]
---

# Interrupted-output test readiness

## Files

- `apps/opencode_fork/packages/opencode/test/session/prompt.test.ts`

## Checks

- Root: `cd apps/opencode_fork/packages/opencode && bun test test/session/ src/session/` — 396 passed, 5 skipped, 1 todo, 0 failed; 1,100 assertions across 402 tests/27 files in 76.59 seconds. Log: `/tmp/rhythm-device-engine-session-final.log`.
- `git diff --check` passed. GitNexus `detect-changes --scope all` reported 18 files/45 symbols across the concurrent worktree, zero affected indexed processes, LOW risk. The commit stages only this test and this receipt.

## Notes

The model request arriving did not establish that the shell had emitted its output. Cancelling after a fixed 150 milliseconds could interrupt cold shell/parser initialization and invalidate the truncation test setup. The test now waits for a fixed, temporary-workspace readiness file written after the 4,000 output lines, then cancels. All truncation, output-file and interrupted-state assertions remain intact. No engine production code changed.

This closes the recorded engine suite failure. It does not claim the whole mega release or physical-device qualification is complete.
