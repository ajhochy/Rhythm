# Project State

## Current focus

The `mega-ws/plumbing` worktree contains the complete implementation for issues #1324, #1325, #1326, #1358, #1365, and #1347. Verification is blocked by this managed sandbox's socket and dependency restrictions, so the branch is not ready for handoff as passing.

## Active branch / PR

- Worktree: `.mega-wt/ws-plumbing` only; the main checkout was not used.
- Branch: `mega-ws/plumbing`.
- PR: none; nothing was pushed.
- Committed: `32845d44` (#1324), `5c0183a5` (#1325), `9c3231e0` (#1326).
- Uncommitted: #1358, #1365, #1347, their tests/contracts, and this run documentation. Git cannot create the worktree index lock because `.git/worktrees/ws-plumbing` is outside the writable sandbox.

## In progress

- Re-run Flutter tests and the isolated live behavioral tests in an environment that permits loopback sockets.
- Install/restore the vendored engine dependencies so `bun run build --single` resolves `@opentui/solid/preload`.
- Capture the #1358 transcript error/retry visual checkpoint.
- Commit #1358, #1365, and #1347 incrementally after Git worktree metadata is writable.

## Risks / known issues

- Live backend behavior has not been exercised because `tools/dev/sandbox.sh up` stops at the missing engine preload dependency.
- Flutter's test runner cannot bind `127.0.0.1:0`; all 165 discovered test files fail to load before executing assertions.
- The canonical workflow wrapper also uses unwritable Flutter cache paths and network-dependent `npx` resolution in this sandbox.
- #1358 and #1365 contract criteria that depend on Flutter/live execution remain `pending`; no passing claim should be made from static checks alone.
- Automatic managed-browser discovery now intentionally refuses the default macOS Google Chrome GUI bundle; operators need Chrome for Testing, Chromium, or an explicit `RHYTHM_CHROME_BIN`.
- Never start a bare api_server; use `tools/dev/sandbox.sh` so ports 4098/4097 remain isolated from the shipping client.

## Test status

- PASS: API TypeScript build/no-emit and focused contracts (6 files, 35 passed, 2 env-gated live tests skipped).
- PASS: full Flutter format and analyze (`296` pre-existing infos, exit 0).
- PASS: focused fork engine identity test (1 test).
- PASS: managed Chrome focused suites (26 tests) and Impeccable UI detector.
- BLOCKED: full Flutter tests (`0` passed, `165` files failed to load; socket `EPERM`).
- BLOCKED: live sandbox build (`@opentui/solid/preload` missing); no listeners were started and the temporary sandbox was removed.
- BLOCKED: MCP TypeScript check because the package dependency tree is absent.
- Full API suite: HTTP-listener tests consistently time out under socket `EPERM` while non-listener tests run; the long diagnostic run is retained as environmental failure evidence rather than a passing gate.

## Next step

Restore Git metadata write access and vendored/MCP dependencies, then run the canonical PR gate, Flutter tests, isolated live behavioral tests, and #1358 visual smoke. If they pass, update pending contracts and commit #1358, #1365, and #1347 separately. Do not push.
