# Project State

## Current focus

Mobile gateway request cost. Session-scoped gateway requests listed the
project's engine sessions to authorize a single id; an explicit ownership row
now short-circuits that to one indexed local read with no engine traffic.

## Active branch / PR

- Branch: `claude/mobile-direct-agent-connection-hu75he`
- Base: `main`
- PR: none yet — landing target undecided (main, or stacked on the open draft
  PR [#1319](https://github.com/ajhochy/Rhythm/pull/1319) `mega/run-2026-08-04`,
  which does not touch these files).
- Merge remains a manual human action after review.

## In progress

- Fix 3 from the latency diagnosis — short-circuit owner checks when the Mac
  has exactly one paired user — deliberately not built. It changes what the
  #1175 two-account contract asserts, so it is a user decision.

## Risks / known issues

- Catalog-scoped client calls (`/session`, `/permission`, `/question` without
  the gateway prefix) 502 against the paired gateway origin whenever polling
  runs in a degraded state — pre-existing path mismatch newly visible now that
  polling correctly runs while the stream is unproven. Note on #1287.
- Exact-owner projectless server-side filter from `cdd0bb465` remains in place
  and required; unchanged by this fix.
- User-owned `.proof/` image modifications remain excluded from commits.

## Test status

- api_server: `tsc --noEmit` clean; full serial vitest suite PASS —
  468 files / 3,838 tests, 85 files and 128 tests skipped, 0 failures.
- New `mobile_session_authorization_cost.test.ts` verified fail-first against
  the pre-change sources; #1175/#1169/#1285 contract files pass unmodified.
- GitNexus MCP tools were unavailable this session, so the CLAUDE.md
  `impact` / `detect_changes` steps were not run for this change.
- Mobile: typecheck PASS, lint 0 errors, jest 24/24 PASS (incl. new
  `global-event-stream` regression), fake-server self-test PASS, contract
  PASS, Playwright web E2E 71/71 PASS.
- Physical iPhone: desktop→mobile and mobile→desktop both live without
  refresh, full boundary diagnostics captured (see run log
  2026-08-01-issue-1287-native-sse-stream.md).

## Next step

Decide where the gateway-cost change lands (main vs stacked on #1319), then
whether Fix 3 is wanted.

Follow-ups tracked on issue #1287: desktop persisting profile bindings onto
agent_sessions rows; decision on cleaning pre-fix corrupted profile rows;
cold-start first-open latency budget; device-tier test gap for scope-flip
cache lifecycles.
