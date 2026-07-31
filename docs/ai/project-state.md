# Project State

## Current focus

Runtime/session-isolation/performance + mobile-parity repair run: 15 draft
PRs (#1254–#1268) spanning P0 memory-injection relevance, R1–R6 runtime
repairs, and MSP-001–006 mobile parity. Nothing merged; production untouched.

## Active branch / PR

- Integration target: `codex/fix-session-isolation-runtime-performance`
  ([#1268](https://github.com/ajhochy/Rhythm/pull/1268)) — all runtime lanes
  cherry-picked, combined suites 82/82, one-pass desktop smoke checklist in
  the PR body.
- Lane PRs #1254–#1267 are the review/merge units (see run log
  `docs/ai/runs/2026-07-30-runtime-mobile-parity-run.md`).

## In progress

- MSP-004 (#1264): repairing 2 issue-1237 reachability specs (offline exit,
  single recovery refresh) regressed by the atomic open flow.
- MSP-002 (#1266): CI rerunning on the repaired MSP-001 base.
- Human smokes: integration desktop pass (#1268 checklist), physical iPhone
  composer walk (#1259 + dev build via `EXPO_APP_VARIANT=development`),
  desktop→iPhone pairing (#1254).
- MSP-007 cross-client parity gate: last, needs paired user + 2 projects +
  3 profiles + throwaway device creds; produces evidence + release
  recommendation only (no release/TestFlight).

## Risks / known issues

- Live gates found and fixed two P0 retrieval defects (owner visibility,
  relevance stopword drift) — unit suites had mocked past both; treat live
  gates as mandatory for memory/retrieval changes.
- `live_e2e_948_949` draft-file assertion is timing/LLM-decline flaky
  (curator 90s cold-window silently drops queued extraction) — test-design
  follow-up, documented in #1255.
- Historical telemetry rows (7,435 amplified events) and P0-contaminated
  transcripts intentionally NOT rewritten — each needs a separately reviewed
  destructive migration.
- Merge order for stacks: #1254 → #1258; #1254 → #1263 → (#1264, #1266,
  #1259-cherry); #1261 → #1265. Do not delete base branches until children
  retarget.

## Test status

- Every lane: contract-first red→green + orchestrator-verified suites; CI
  green on #1254–#1263, #1265, #1267, #1268 at time of writing.
- Live sandbox gates PASS: R1, R2, R3, R4, R5, R6 (config check), P0, MSP-003.
- Mobile foundation: 69/69 on repaired MSP-001 and MSP-006 heads.

## Next step

Finish MSP-004 repair + #1266 CI; then human smokes; then MSP-007 parity
gate with recorded evidence and the release/TestFlight handoff document
(human executes any release).

## Recent coding-agent runs

### 2026-07-30 — issue #1279 All Sessions visibility follow-up

- Branch: `codex/fix-1279-unscoped-session-visibility`.
- Files modified: mobile ownership repository, #1279 acceptance/live tests,
  acceptance contract, and run log.
- Checks run: acceptance red 9 passed / 2 failed, green 11/11; related mobile
  security 52/52; api_server typecheck/build; issue gate 4/4; isolated live
  gateway 1/1. Full PR gate passed every stage through mobile fake-server
  self-test, then reproduced the known active `issue-1237-c5` E2E failure.
- Decision: keep exact owner matching and exact matching for non-empty project
  IDs; only `NULL`/empty project IDs are unrestricted.
- Deviations from spec: none.

### 2026-07-30 — issue #1279 mobile session claim fallback

- Files modified: mobile ownership repository/security, #1279 contract + live
  tests, acceptance contract, and run log.
- Checks run: contract 6/6; related set 61 passed / 1 skipped; api_server
  typecheck/build pass; fork build pass; isolated live gateway 1/1; #1175
  corrective security 3/3 before and after.
- Decisions made: reuse the existing `agent_sessions` lookup; keep the reader
  method optional for injected test doubles; gate the fallback to sessions.
- Deviations from spec: none.
- Concerns: repo-wide issue checks retain a pre-existing unrelated
  `apps/mcp_server` TypeScript-runner failure; see
  `docs/ai/runs/2026-07-30-issue-1279-mobile-session-claim-gap.md`.
