---
date: 2026-07-26
repo: Rhythm
branch: codex/1186-sandbox-foreground
pr: null
issues: [1186]
status: passed
tags: [run, Rhythm, dev-sandbox, live-e2e]
---

# #1186 automation-stable foreground sandbox

## Files

- `tools/dev/sandbox.sh` — added explicit `up --foreground` mode. It performs
  the same isolated build, launch, and dual-health readiness checks as plain
  `up`, then waits on the API process so a non-interactive command host remains
  attached. Both modes record the ready engine's exact PID only after its
  executable matches this worktree's built fork. `down` uses that identity to
  remove a surviving sandbox engine, while PID or executable mismatches fail
  closed. Plain `up`, `status`, and `down` retain their existing interfaces.
- `apps/api_server/src/__tests__/issue_1186_sandbox_foreground.test.ts` — fast
  process-level Bash coverage for background compatibility, foreground hold,
  unexpected child exit propagation, status, argument validation, and
  unrelated-PID refusal.
- `apps/api_server/src/__tests__/issue_1186_sandbox_foreground.live.test.ts` —
  gated live lifecycle coverage that builds and launches the real fork and API
  on the canonical sandbox ports.
- `docs/ai/contracts/issue-1186.json` — acceptance criteria and durable test
  mapping.
- `docs/ai/testing-guide.md` — foreground automation usage.

## Checks

- `bash -n tools/dev/sandbox.sh` — PASS.
- `npx vitest run src/__tests__/issue_1186_sandbox_foreground.test.ts
  src/__tests__/issue_1186_sandbox_foreground.live.test.ts` — PASS, 7 focused
  tests in 28.23 seconds; the clean foreground shutdown handshake passed 20
  consecutive iterations, PID and executable mismatches were refused without
  killing their processes, and the live test skipped without its two explicit
  flags.
- `npx --no-install tsc --noEmit` — PASS.
- `npm run build` — PASS.
- `npm test --silent` — PASS: 373 files passed, 34 skipped; 3,252 tests passed,
  57 skipped in 34.71 seconds on the final rerun.
- `bun run build --single` with Bun 1.3.13 — PASS, including the produced
  binary's version smoke.
- `RHYTHM_LIVE_E2E=1 RHYTHM_SANDBOX_LIFECYCLE_E2E=1 npx vitest run
  src/__tests__/issue_1186_sandbox_foreground.live.test.ts` — PASS, 1/1 in
  43.92 seconds on the final engine-ownership rerun:
  - the non-interactive foreground launcher remained alive after readiness;
  - API `:4098` and engine `:4097` remained bound;
  - `/health` and `/opencode/health` remained successful after a two-second
    post-readiness grace interval;
  - protected listeners stayed API `:4001` PID 965 and engine `:4096` PID 1011
    during launch and after teardown;
  - `status` reported the running sandbox PIDs;
  - `down` ended the foreground holder with exit code 0, removed the sandbox,
    and freed `:4097` and `:4098`;
  - a second regular `up` recorded the exact `:4097` engine PID;
  - the test SIGKILLed only that sandbox API and observed `:4098` free while
    the recorded engine remained on `:4097`;
  - `down` matched the surviving PID and built-fork executable, stopped only
    that orphan, removed the sandbox, and freed both ports;
  - a separate `down` call refused an unrelated `sleep` PID and left it alive.
- Repo-local `checks --level issue` and `checks --level pr` — Dart format,
  TypeScript, and full API Vitest checks PASS. Flutter analyze is
  environment-blocked before analysis because the only installed SDK is
  Flutter 3.24.5 / Dart 3.5.4 while current `gpt_markdown` requires Dart 3.7 or
  newer. No Flutter files changed in this issue.
- `git diff --check` — PASS.

## Failure triage

- The first live invocation failed before launch because Bun was absent from
  the command host's PATH. The second repo-root invocation had no Vitest binary.
  Both stopped before binding either sandbox port.
- After selecting the pinned Bun 1.3.13 binary, the fresh worktree's first fork
  build failed because workspace dependencies were not installed
  (`@opentui/solid/preload` missing). `bun install` populated ignored
  `node_modules`; the fork build and live lifecycle then passed.
- Review of the first green live run found that `down` could remove its shutdown
  marker before the foreground waiter read it. The final implementation writes
  a foreground-holder PID, has the waiter acknowledge the requested shutdown,
  and makes `down` wait for that acknowledgment before removing the sandbox.
  The 20-iteration process stress and real live rerun both passed.
- A parallel regular-`up` smoke then reproduced an API-owned engine orphan:
  API PID 80485 logged clean shutdown, while engine PID 80518 reparented to PID
  1 and retained `:4097`. Its executable, HOME, working directory, and sandbox
  port environment all matched that sibling sandbox. This was treated as
  in-scope automation teardown, not a separate product-engine change.
- The first engine-recording live run found a short health-to-`lsof` timing
  window: both API health checks passed just before the listener appeared in
  `lsof`. Identity recording now polls for up to five seconds after health,
  still failing closed on multiple listeners or an executable mismatch. The
  final combined live run passed.
- One final full-suite run had an unrelated intermittent `issue_637_contract`
  failure: a curated-model request returned 401 instead of 200. The focused
  file immediately passed 3/3 without a code change, and the complete API suite
  then passed 3,250/3,250 runnable tests. No #1186 file touches that auth/model
  path.
- `bun install` and the fork build rewrote the vendored lockfile. The original
  `apps/opencode_fork/bun.lock` was restored, and final status contains only the
  intended #1186 files.
- GitNexus returned UNKNOWN rather than a risk rating for `up`, `down`, and
  `status` because its TypeScript-oriented symbol graph does not index these
  Bash functions. The focused process tests and real lifecycle test compensate
  for that graph gap.

## Notes

- Live tests using fixed `:4097/:4098` were serialized with the parallel issue
  tracks.
- The live test is intentionally double-gated by `RHYTHM_LIVE_E2E=1` and
  `RHYTHM_SANDBOX_LIFECYCLE_E2E=1`; the normal API suite never builds or starts
  a sandbox.
- No production database, HOME-relative runtime, protected listener, or
  unrelated process was modified.
- The engine fallback is sandbox-only. Production `opencodeClient.dispose()`
  and protected ports `:4001/:4096` are unchanged.
