---
date: 2026-08-08
repo: Rhythm
branch: ui/desktop-mobile-session-polish
pr: 1337
issues: [1337]
status: pass
tags: [run, mobile, e2e, failure-triage]
---

## Files

- `apps/mobile/tests/e2e/flows.spec.mjs`
- `apps/mobile/tests/fake-opencode/server.mjs`
- `apps/mobile/tests/fake-opencode/self-test.mjs`

## Failure

Mobile CI run `31298860897` job `93208279210` ("Verify mobile foundation"): 70 passed,
1 failed — `tests/e2e/flows.spec.mjs:303 settings explain root-vs-api mismatches and
reconnect through a prefixed API base URL`, identically on the first attempt and both
retries:

```
Error: listen EADDRINUSE: address already in use 127.0.0.1:44196
Error: Timed out waiting for fake server at http://127.0.0.1:44196/api/path
  at waitForServer (apps/mobile/tests/e2e/flows.spec.mjs:92:9)
```

## Root cause

The spec hardcoded `const port = 44196` for the prefixed fake server it spawns. `44196`
sits inside the Linux ephemeral port range (`32768-60999`, the ubuntu-latest default), so
any transient localhost socket already open in the job can own it; Node then refuses the
`listen`, the child dies, and each retry re-picks the same doomed port. macOS starts its
ephemeral range at `49152`, which is why the spec never failed on a dev machine.

Evidence the holder was not a leftover of this spec: the port was already taken on the
*first* attempt (06:28:39, before any retry), and nothing answered `/api/path` for 30s —
a leaked instance of this same server would have served it and the test would have passed.

Classification: **pre-existing test-harness defect, not a PR regression.** `origin/main`
carries the byte-identical hardcoded port; the PR's only mobile production change is an
optional-field omission in `providers/opencode-provider.tsx`.

## Fix

`FAKE_OPENCODE_PORT=0` — the kernel assigns a free port, and `server.mjs` now logs the
port it actually bound so the spec can read it back off stdout. Teardown awaits child exit
with a `SIGKILL` escalation, because `SIGTERM` runs `server.close()`, which the browser's
keep-alive sockets can hold open past the test. All connection/mismatch assertions are
unchanged and still run against a real `/api`-prefixed server.

## Checks

- PASS (reproduction): with `44196` held by a foreign listener, the pre-fix spec failed
  on all 3 attempts with the exact CI signature —
  `CI=1 PLAYWRIGHT_FAKE_PORT=44337 PLAYWRIGHT_WEB_PORT=19337 npx playwright test tests/e2e/flows.spec.mjs --grep "root-vs-api"`
- PASS (post-fix, same condition, 3 consecutive runs): 1 passed each, no EADDRINUSE.
- PASS: `npm run test:fake-server:self` — new regression check starts two concurrent
  `FAKE_OPENCODE_PORT=0` instances (a test and its retry) and asserts distinct, live ports.
  Falsified by `git stash`-ing the `server.mjs` change: fails with
  `Ephemeral instances shared a port`.
- PASS: `CI=1 PLAYWRIGHT_FAKE_PORT=44337 PLAYWRIGHT_WEB_PORT=19337 npm run verify:foundation`
  → `EXIT=0`, 71 passed (2.2m), zero EADDRINUSE occurrences.
- PASS: `npm run lint` (0 errors; 3 pre-existing warnings in untouched files),
  `npm run typecheck`.
- GitNexus: `impact(waitForServer, upstream)` LOW / 0 consumers;
  `detect_changes()` LOW risk, 3 test files, 0 affected processes.

## Lifecycle repair attempt 2

The first re-verification exposed a harness-only lifecycle gap: prefixed-server
startup waited indefinitely for stdout and happened before the test's `try/finally`;
startup promises also missed `error`, and self-test shutdown sent `SIGKILL` without
awaiting child exit.

- Contract first: `node tests/fake-opencode/self-test.mjs` failed before the repair
  with `Expected startup failure containing timed out`.
- PASS: the same self-test now deterministically exercises a silent child (`100ms`
  timeout), a missing executable (`error`), two concurrently started port-0 servers,
  and awaited graceful/escalated teardown.
- PASS: `node tests/playwright-port-isolation.test.mjs` covers the occupied-port
  rejection in both local and `CI=1` modes.
- PASS: `CI=1 PLAYWRIGHT_FAKE_PORT=44337 PLAYWRIGHT_WEB_PORT=19337 npm run
  verify:foundation` — 71/71 Playwright tests, including the prefixed-server flow.
- PASS: `npm run lint` (0 errors; 3 pre-existing warnings) and `npm run typecheck`.

Startup listeners and timers are removed on every resolve/reject path. Startup
failure awaits idempotent child teardown before returning, and the Playwright test
enters `try/finally` before it starts the child.

The intentionally failing pre-repair contract left one old fake-server child
(`PID 36771`) because the prior finalizer did not await it; it was terminated
without touching any live port. A final self-test plus `pgrep` and `lsof :4196`
reported no fake-server process or listener.

## Notes

Test-harness-only change; no product code touched. Local Playwright runs rewrote
nine tracked `.proof/**` screenshots; the orchestrator restored them to `HEAD`, so
none are included in the final diff.

Final focused verification passed the self-test, two occupied-port Playwright runs,
the 71-test foundation suite, lint, typecheck, lifecycle inspection, and orphan/listener
checks. The only post-test drift was the expected generated proof output, which was
restored before commit.

`apps/mobile/tests/playwright-port-isolation.test.mjs` is wired into no npm script, so it
never runs in CI. Not fixed here (out of scope); worth a follow-up.
