---
date: 2026-10-20
repo: Rhythm
branch: test/feature-playwright-2026-10-19
pr: null
issues: [1186, 1574]
status: in_progress
tags: [run, Rhythm]
---

# Engraph aggregate diagnosis and sandbox fixture repair

## Files

- `apps/api_server/src/__tests__/issue_1186_sandbox_foreground.test.ts`: place its disposable sandbox fixture under `/private/tmp` on macOS and `/tmp` elsewhere, matching the sandbox's approved path policy independently of the build guard's `TMPDIR`.
- `apps/api_server/src/__tests__/issue_1574_engraph_ownership.test.ts`: keep every positive enable expectation exact while showing each manager's recorded `lastFailureMessage` only if the enable fails, including concurrent starts.

## Checks

- RED: `npm run build:guard -- /bin/zsh -f -c 'cd apps/api_server && npm test --silent -- --fileParallelism=false'` exited 1. Complete retained output: `/private/tmp/rhythm-engraph-full-api-2026-10-20.log`. It ran 1,056 files and 9,164 tests in 1,054.87 s: 878 files passed, 177 skipped, one failed; 8,779 tests passed, 382 skipped, three failed. All three failures were in `issue_1186_sandbox_foreground.test.ts`. The first explicitly reported `RHYTHM_SANDBOX_DIR must resolve under /tmp, /private/tmp, or /var/folders` for a fixture under the guard's Documents scratch `TMPDIR`. The Engraph ownership file passed in this controlled aggregate.
- GREEN focused: `npm run build:guard -- /bin/zsh -f -c 'cd apps/api_server && npx vitest run src/__tests__/issue_1186_sandbox_foreground.test.ts --fileParallelism=false'` passed 7/7 in 18.48 s after the fixture change. Log: `/private/tmp/rhythm-1186-guard-green-2026-10-20.log`.
- `npm run build:guard -- /bin/zsh -f -c 'cd apps/api_server && npx vitest run src/__tests__/issue_1574_engraph_ownership.test.ts --fileParallelism=false'` passed 19/19 in 14.34 s after the diagnostic assertion edit. Complete retained output: `/private/tmp/rhythm-engraph-diagnostic-focused-2026-10-20.log`.
- `git diff --check` passed after the diagnostic assertion edit.
- GREEN controlled aggregate at source baseline: `npm run build:guard -- /bin/zsh -f -c 'cd apps/api_server && npm test --silent -- --fileParallelism=false --reporter=default --reporter=json --outputFile.json=/private/tmp/rhythm-api-final-20261020.json'` exited 0. Retained complete stdout: `/private/tmp/rhythm-api-final-20261020.log`; machine report: `/private/tmp/rhythm-api-final-20261020.json`. Vitest reported 884 passed + 180 skipped files (1,064 total), 8,799 passed + 385 skipped tests (9,184 total), duration 1,131.93 s. `issue_1574_engraph_ownership.test.ts` passed 19/19, `issue_1186_sandbox_foreground.test.ts` passed 7/7, and the new local schedule auth attribution file passed 4/4 inside this same run. This is the second controlled aggregate non-reproduction of the historical five Engraph `spawn_failed` assertions, not proof that their original cause was fixed.

## Notes

- The earlier PR gate's five Engraph `spawn_failed` assertions remain a historical failure, not a proven repair. Its workflow wrapper kept only the last 30 output lines, omitting the first three case names and every `lastFailureMessage`. The visible fourth and fifth cases were positive enables at ownership-test lines 155 and 172. The first five declarations in that file are consecutive, so a transient `/bin/ps` snapshot failure is a plausible explanation: startup deliberately fails closed when it cannot inspect processes, and status cannot discover the old-port process from an empty snapshot. No OS-probe result or resource measurement from that failure was retained, so this cause is unproven. The original guard peak was 3,438,017,201 bytes, below the 10 GiB cap.
- The current controlled full serial run used the same guard with no overlapping packaged build and passed the Engraph ownership tests. Earlier focused controls passed 19/19 and the related serial cluster 99/99. These establish non-reproduction under controlled conditions, not a product code fix.
- GitNexus upstream impact for test helpers `fakeSandboxEnv` and `manager`, and `EngraphManager.enable`, returned UNKNOWN against an index 263 commits behind this worktree. Manual caller review found six `fakeSandboxEnv` callers confined to the sandbox test file. The Engraph diagnostic edit changes only test assertions; production ownership and fail-closed paths remain unchanged.

## Real CLI qualification continuation

- Isolated version check against the installed arm64 CLI with fresh private HOME, empty inherited environment, and build guard returned `engraph 1.7.2`; binary `/Users/ajhochhalter/.local/bin/engraph`. No operator profile was used.
- Fresh synthetic-only source fixture `/private/tmp/rhythm-engraph-real-fixture-20261020-a` contains a 0400 SQLite DB and 0400 OpenCode config with one safe local MCP entry. The guarded preserved foreground sandbox attempt at `/private/tmp/rhythm-engraph-real-sandbox-20261020-a` exited 1 before any Engraph choose/enable or memory note write. Complete launcher log: `/private/tmp/rhythm-engraph-real-sandbox-up-20261020.log`; preserved API and engine build logs remain under the sandbox root. Guard peak was 6,728,449,885 bytes, below 10 GiB. Recorded API/holder PIDs are dead; ports 4098/4097/4099 have no listeners.
- The failed preserved sandbox named a private `$SB/engine-build/opencode-darwin-arm64/bin/opencode` path that did not exist. Its fork build script wrote the freshly built fork to the ordinary worktree `dist` path; the API then ignored the absent override and spawned a stock PATH binary, which rejected Rhythm's `reference` config key. The exact signature and fallback mechanism match the prior E02 run record `docs/ai/runs/2026-09-10-electron-e02-harness.md`. Current fork source contains the `reference` schema. This is a sandbox preservation-mode harness failure, not an Engraph result. A fresh normal sandbox with exact fork ownership remains pending after runtime-lane coordination; the vendored fork builder remains unchanged.

## Sandbox fork-output fail-closed guard

- GitNexus upstream impact for shell `build_engine` returned target-not-found / UNKNOWN against an index 289 commits behind this checkout. Manual callers are launcher `up()` and focused shell tests; the new check stops `up()` before API startup when its exact fork executable is absent. No process-identity, Keychain, fixture-path, or Engraph ownership checks changed.
- RED: `npm run build:guard -- python3 -m unittest tools.dev.sandbox_build_envelope_test.BuildEnvelope.test_successful_build_without_expected_fork_binary_fails_closed` failed its behavioral assertion because a zero-exit fake Bun wrote no `$ENGINE_BIN` yet `build_engine` returned 0 (`AssertionError: 0 == 0`). Earlier test-harness import errors were corrected before this valid RED.
- GREEN: the launcher now checks its post-build output is a regular executable owned by the current account and is not a symlink. The focused `npm run build:guard -- python3 -m unittest tools.dev.sandbox_build_envelope_test` passed 2/2. Its older static build-envelope substring expectation was updated to account for the existing preservation argument while still requiring the sanitized runtime environment and fixed model fixture. `bash -n tools/dev/sandbox.sh` and `git diff --check` passed.
- Broader `npm run build:guard -- bash tools/dev/sandbox_guard_test.sh` returned 18 passed, 3 failed. All three failures are its unrelated `restart-engine` cases that substitute nonexistent API PID 4242; current strict sandbox attachment refuses absent kernel process metadata. The new build-output cases in that script passed. The synthetic restart fixture remains an open, separate harness gap; no process-identity check was relaxed.
