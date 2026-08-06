# Project State

## Current focus

Mobile gateway authorization: cost and correctness, on PR
[#1327](https://github.com/ajhochy/Rhythm/pull/1327).

1. Session-scoped requests listed the project's engine sessions to authorize a
   single id; an explicit ownership row now short-circuits that to one indexed
   local read with no engine traffic.
2. Subagent approvals never reached the phone. A subagent runs in a child
   session, `PermissionRequest.sessionID` names that child, and children
   spawned inside the engine never pass through the proxy so they never get an
   ownership row — their approvals were filtered out and replying 404'd.
   Authorization now walks `parentID` ancestry.

## Active branch / PR

- Branch: `claude/mobile-direct-agent-connection-hu75he`
- Base: `main`
- PR: none yet — landing target undecided (main, or stacked on the open draft
  PR [#1319](https://github.com/ajhochy/Rhythm/pull/1319) `mega/run-2026-08-04`,
  which does not touch these files).
- Merge remains a manual human action after review.

## In progress

- Local verification of #1327 against real session history and a real subagent
  approval on device.

## Corrections on record

- The two-account isolation guard is **not** in
  `issue_1175_mobile_gateway_security.test.ts` — that file has no two-account
  assertions. It lives in `issue_1285_mobile_chat_discovery.test.ts`
  (ownerA/ownerB). The 2026-07-30 session-visibility decision mis-attributed
  it to #1175.
- User has declared the two-account concern void for this deployment. The
  owner-dimension short-circuit was still not built: the confirmed defect was
  child-session ancestry, not owner matching, so relaxing owner checks would
  not have fixed it.

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
  469 files / 3,842 tests, 85 files and 128 tests skipped, 0 failures.
- Both new tests verified fail-first against the pre-change sources;
  #1175/#1169/#1285/#1286 contract files pass unmodified.
- GitNexus MCP tools were unavailable this session, so the CLAUDE.md
  `impact` / `detect_changes` steps were not run for this change.
- Mobile: typecheck PASS, lint 0 errors, jest 24/24 PASS (incl. new
  `global-event-stream` regression), fake-server self-test PASS, contract
  PASS, Playwright web E2E 71/71 PASS.
- Physical iPhone: desktop→mobile and mobile→desktop both live without
  refresh, full boundary diagnostics captured (see run log
  2026-08-01-issue-1287-native-sse-stream.md).

## Next step

Verify #1327 on device: confirm a real subagent approval now surfaces and can
be replied to from the phone, then mark the PR ready and merge after sign-off.

Follow-ups tracked on issue #1287: desktop persisting profile bindings onto
agent_sessions rows; decision on cleaning pre-fix corrupted profile rows;
cold-start first-open latency budget; device-tier test gap for scope-flip
cache lifecycles.
