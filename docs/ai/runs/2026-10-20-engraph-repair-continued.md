---
date: 2026-10-20
repo: Rhythm
branch: test/feature-playwright-2026-10-19
pr: null
issues: [1186, 1574]
status: unverified
tags: [run, Rhythm]
---

# Engraph aggregate diagnosis and sandbox fixture repair

## Files

- `apps/api_server/src/__tests__/issue_1186_sandbox_foreground.test.ts`: place its disposable sandbox fixture under `/private/tmp` on macOS and `/tmp` elsewhere, matching the sandbox's approved path policy independently of the build guard's `TMPDIR`.
- `apps/api_server/src/__tests__/issue_1574_engraph_ownership.test.ts`: keep every positive enable expectation exact while showing each manager's recorded `lastFailureMessage` only if the enable fails, including concurrent starts.

## Checks

- RED: `npm run build:guard -- /bin/zsh -f -c 'cd apps/api_server && npm test --silent -- --fileParallelism=false'` exited 1. Complete retained output: `/private/tmp/rhythm-engraph-full-api-2026-10-20.log`. It ran 1,056 files and 9,164 tests in 1,054.87 s: 878 files passed, 177 skipped, one failed; 8,779 tests passed, 382 skipped, three failed. All three failures were in `issue_1186_sandbox_foreground.test.ts`. The first explicitly reported `RHYTHM_SANDBOX_DIR must resolve under /tmp, /private/tmp, or /var/folders` for a fixture under the guard's Documents scratch `TMPDIR`. The Engraph ownership file passed in this controlled aggregate.
- GREEN focused: `npm run build:guard -- /bin/zsh -f -c 'cd apps/api_server && npx vitest run src/__tests__/issue_1186_sandbox_foreground.test.ts --fileParallelism=false'` passed 7/7 in 18.48 s after the fixture change. Log: `/private/tmp/rhythm-1186-guard-green-2026-10-20.log`.
- `git diff --check` passed after the diagnostic assertion edit. Focused Engraph and second full API suite remain pending after the shared source/build freeze.

## Notes

- The earlier PR gate's five Engraph `spawn_failed` assertions remain a historical failure, not a proven repair. Its workflow wrapper kept only the last 30 output lines, omitting the first three case names and every `lastFailureMessage`. The visible fourth and fifth cases were positive enables at ownership-test lines 155 and 172. The first five declarations in that file are consecutive, so a transient `/bin/ps` snapshot failure is a plausible explanation: startup deliberately fails closed when it cannot inspect processes, and status cannot discover the old-port process from an empty snapshot. No OS-probe result or resource measurement from that failure was retained, so this cause is unproven. The original guard peak was 3,438,017,201 bytes, below the 10 GiB cap.
- The current controlled full serial run used the same guard with no overlapping packaged build and passed the Engraph ownership tests. Earlier focused controls passed 19/19 and the related serial cluster 99/99. These establish non-reproduction under controlled conditions, not a product code fix.
- GitNexus upstream impact for test helpers `fakeSandboxEnv` and `manager`, and `EngraphManager.enable`, returned UNKNOWN against an index 263 commits behind this worktree. Manual caller review found six `fakeSandboxEnv` callers confined to the sandbox test file. The Engraph diagnostic edit changes only test assertions; production ownership and fail-closed paths remain unchanged.
