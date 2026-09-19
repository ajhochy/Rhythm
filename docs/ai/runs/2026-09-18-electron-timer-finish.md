---
date: 2026-09-18
repo: Rhythm
branch: mega/2026-09-18-mobile-electron-hermes
pr: 1544
issues: []
status: pass
tags: [run, Rhythm]
---

# Electron Hermes readiness timer finish

## Files

- `apps/electron/src/hermes-server.mjs`: add injectable readiness clock and delay; production defaults remain `Date.now` and `node:timers/promises` delay.
- `apps/electron/test/hermes-server.test.mjs`: advance the injected clock through the original 15 ms deadline for HTTP 401/404/503 and invalid health JSON. Keep the retry, failure status, and never-ready assertions.
- `.proof/mega-2026-09-18/electron-timer-gate.log`: full command output, including the initial failed gate and subsequent consecutive runs.

## Checks

- Test-first: `cd apps/electron && node --experimental-vm-modules --test --test-concurrency=1 --test-name-pattern='Hermes readiness rejects HTTP' test/hermes-server.test.mjs` failed 0/3 before source injection because fake time stayed at zero; passed 3/3 after injection.
- Initial full gate: `cd apps/electron && npm test` passed 162/163. The adjacent invalid-health-JSON test had the same wall-clock retry flake, so it received the same fake clock without weakening its retry assertion.
- Focused retest: `cd apps/electron && node --experimental-vm-modules --test --test-concurrency=1 --test-name-pattern='Hermes readiness rejects' test/hermes-server.test.mjs` passed 4/4.
- Final gate: `cd apps/electron && npm test` passed **163/163 on three consecutive runs**; `cd apps/electron && npm run typecheck` exited 0.
- `git diff --check` exited 0.
- GitNexus impact before edits: `createHermesSupervisor` LOW, one direct caller (`apps/electron/src/main.mjs`), zero affected processes; test `fixture` LOW, one test-file caller. `detect-changes -s unstaged` reported LOW, zero affected processes; it also saw concurrent web/backend edits outside this slice.

## Decisions

- Keep the 15 ms test deadline and the `requests > 1` expectation. Inject only the clock and poll delay used by readiness so event-loop load cannot spend the deadline before a retry.
- Apply the same clock to the neighboring invalid-health-JSON case after the first full run proved it had the identical failure mode.
- Retain the real `AbortSignal.timeout` and production readiness timing defaults. The tests use an immediate fake fetch, while production continues using wall-clock time.
- Run no native Electron app or local server for this test reliability change; no API/engine ports or running applications were touched.
