---
date: 2026-08-10
repo: Rhythm
branch: mega-ws/permissions
pr: null
issues: [1341, 1367, 1322, 1340]
status: partial
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# Permission pipeline

## Files changed

- Fork permission reply matching and HTTP not-found handling.
- API permission-mode enforcement, bridge ask/reply forwarding, REST fallback routes, and regression tests.
- Acceptance contracts for #1341, #1367, #1322, and server-side #1340.
- E2/E4 smoke wording and an env-gated #1322 live test.

## Checks run

- `apps/opencode_fork/packages/opencode: bun run typecheck` — PASS.
- `apps/opencode_fork/packages/opencode: bun test test/permission/next.test.ts` — PASS, 80 tests.
- `apps/api_server: ./node_modules/.bin/tsc --noEmit` — PASS.
- `apps/api_server: npm run lint` — PASS, but the script remains a placeholder.
- Focused API permission suites — PASS, including the final eight-file permission scope (130 tests).
- `apps/api_server: npm test` — ENVIRONMENT BLOCKED: 367 files / 3,334 tests passed; 126 files / 719 tests failed because the managed worker forbids loopback socket binding (`listen EPERM`). The isolated one-test reproduction failed in `startTestServer` before application code for the same reason.
- `apps/api_server: npx tsc --noEmit` — ENVIRONMENT BLOCKED when `npx` attempted registry access; the local binary command above passed.
- The env-gated #1322 live sandbox test was authored but not run here, per `.mega-task/BRIEF.md`; the orchestrator must run it in a socket-capable sandbox.

## Notes

- Failure triage classified the full-suite failures as an environment limitation, not product regressions. No timeout or socket-test workaround was added.
- The modern permission reply endpoint's 404 is authoritative. The API no longer converts an unmatched scoped reply into success through the deprecated fallback.
- Commits: `c09e969b` (#1341), `07ca9af1` (#1367), `ae4d5158` (#1322), `b03489a5` (#1340 server).
- No follow-up issue was filed. Required follow-up is the orchestrator's live #1322 test and socket-capable full API suite.
