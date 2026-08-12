---
date: 2026-08-10
repo: Rhythm
branch: mega-ws/plumbing
pr: null
issues: [1324, 1325, 1326, 1358, 1365, 1347]
status: blocked
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# API server plumbing and desktop auth/data-source work

## Files

- #1324: bounded non-paged transcript reads now return the newest 200 messages in ascending order, with a 205-message regression contract.
- #1325: the fork exposes an engine boot identity; the API bridge detects disposal, boot changes, and stale activity, then re-subscribes and reruns durable recovery.
- #1326: api_server console output is teed to a bounded rotating file, a loopback-only tail route exposes recent lines, and the desktop launcher prints the path.
- #1358: local agent data sources omit cloud bearer authentication; transcript load failures are keyed per session and render a retryable error instead of an indefinite waiting state.
- #1365: desktop session creation and agent selection propagate authoritative Rhythm `profileId` values while preserving raw-engine `agentId` fallback behavior.
- #1347: automatic managed-browser discovery prefers Chrome for Testing/Chromium and refuses to headlessly launch the default macOS GUI bundle; explicit overrides remain authoritative.
- Acceptance contracts live under `docs/ai/contracts/issue-{1324,1325,1326,1358,1365,1347}.json`.

## Checks

- TDD red phases were observed before implementation for each issue's new contract.
- `./node_modules/.bin/tsc --noEmit && npm run build && npx vitest run ...`: PASS; 6 focused files, 35 tests passed, 2 env-gated live tests skipped.
- Managed Chrome focused suites: PASS; 26 tests.
- `HOME=/tmp/rhythm-dart-home .../dart format . --set-exit-if-changed`: PASS; 464 files, 0 changed.
- Direct Flutter analyze with `--no-pub --no-fatal-infos`: PASS; exit 0 with 296 pre-existing infos.
- Full Flutter test suite: BLOCKED; 0 tests passed and 165 files failed to load because the runner cannot bind `127.0.0.1:0` (`EPERM`).
- `bun --config=/dev/null test ./test/server/engine-identity.test.ts`: PASS; 1 test.
- `bun run build --single`: BLOCKED; `@opentui/solid/preload` is absent from the pre-cloned dependency tree.
- `tools/dev/sandbox.sh up`: BLOCKED at the same engine build error. `status` showed no 4098/4097 listeners; `down` removed the temporary sandbox.
- MCP TypeScript check: BLOCKED because package dependencies including `@modelcontextprotocol/sdk` and `zod` are absent.
- Impeccable UI anti-pattern detector: PASS (`[]`).
- GitNexus changed-scope analysis: LOW risk across 25 files / 66 symbols after the final implementation edit; no affected execution processes were reported.
- `ai-workflow checks --level smoke`: reports that smoke verification is manual and points to `docs/testing/manual-smoke.md`; the required visual checkpoint remains open.
- Canonical `ai-workflow checks --level pr`: BLOCKED by unwritable Flutter SDK cache paths, network-dependent `npx` resolution, and socket-listener tests; the run was interrupted after the environmental pattern was established.
- Full API suite: started and allowed to continue toward its aggregate; listener-dependent suites systematically hit 15-second socket timeouts in this managed sandbox.

## Notes

- Commits created: `32845d44` (#1324), `5c0183a5` (#1325), `9c3231e0` (#1326).
- #1358, #1365, and #1347 are implemented but uncommitted. Git cannot create `/Users/ajhochhalter/Documents/Rhythm/.git/worktrees/ws-plumbing/index.lock` because the main checkout's worktree metadata is outside the writable sandbox. No attempt was made to alter the main checkout or bypass the restriction.
- #1358 and #1365 contract entries remain `pending` where execution requires Flutter or the live sandbox; results were not inferred from static checks.
- A #1358 screenshot/manual visual checkpoint could not be captured because the Flutter harness cannot start. No shipping-client process was manipulated.
- No push, PR, merge, migration, or production operation occurred.
