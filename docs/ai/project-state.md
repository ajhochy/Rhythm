# Rhythm — Project State

**Focus:** Mobile smart-client rebuild — the phone reads from api_server's SQLite
mirror instead of live-proxying the OpenCode engine. **Implemented, PR open,
awaiting manual test + merge.**
**Branch:** `mobile/sqlite-mirror` → **PR #1384** (https://github.com/ajhochy/Rhythm/pull/1384). Off `main`, which now carries the merged
mega PR #1368). **Do NOT merge** — AJ merges after manual testing.
**Issues:** #1378 (fail soft — complete) · #1379 (cold-start slowness — Phase 1
complete, device evidence still owed).
**Plan:** `docs/ai/plan-mobile-smart-client.md` · **Run log:**
`docs/ai/runs/2026-08-11-sqlite-mirror.md` · **Decision:**
`docs/ai/decisions/2026-08-11-mobile-mirror-reads-fall-through-live.md`

## What shipped on this branch

**Phase 0 (#1378)** — the scope-validation pre-check that fronts every mobile
session open no longer collapses a cold/busy engine into a hard 502. Transient
status or abort → `504 OPENCODE_TIMEOUT`; connection failure → `502
OPENCODE_UNAVAILABLE`; only a definite non-OK answer keeps
`SCOPE_CHECK_FAILED`. The SSE proxy's pre-check — which previously had **no
timeout at all** and leaked thrown errors as a 500 — is bounded and classified
the same way. On the phone, idempotent gateway GETs retry inside one cold-start
budget (400/1200/3000 ms) instead of surfacing the first transient failure.

**Phase 1 (#1379a)** — `experimental.session.list`, `session.children`, and
`session.messages` are served from SQLite, behind the **existing engine-shaped
operationIds**, so `contractFingerprint` does not move and no paired phone
re-pairs. New `agent_session_messages.info_json` stores the engine's
`message.info` verbatim so the transcript is returned in the engine's exact
shape rather than reconstructed. On a mirror hit the engine is contacted **zero**
times (pinned by test). Every ambiguity — a legacy row without `info_json`, an
unknown cursor, an unmirrored or unowned session, an empty mirror for a project,
a missed exact-session lookup, or the local catalog being unavailable — falls
through to the unchanged live path.

**Phase 2 (event-stream decoupling) deliberately deferred.** `ws_gateway`'s
broadcast reaches only loopback clients today, and moving mobile onto it means
re-homing the per-owner/per-project/per-session filtering, dedupe, and 1s
revocation checks plus new reconnect-replay cursor logic — a second PR's worth
of surface that also wants device evidence. Rationale in the run log.

## Test status (this branch)

- api_server: `tsc --noEmit` clean; full serial vitest green.
- mobile: `test:ci:static` green (includes the 7 new cold-start-retry cases);
  `contract:check` green — the engine OpenAPI is untouched.
- New coverage: 46 cases across 6 files (5 api_server + 1 mobile).
- Untouched by this branch: desktop_flutter, mcp_server, opencode_fork.

## Two pre-existing defects fixed in passing

1. `Number(query.get('limit'))` is `0`, not `NaN`, when the parameter is absent —
   so an absent `limit` silently clamped a session page to one item. Invisible
   only because the phone always sends an explicit limit. Fixed once in a shared
   helper used by both the owner-unscoped and the new mirror path.
2. Session-list timestamps were not zone-normalized, so SQLite's
   designator-less `datetime('now')` values were parsed as local time — the same
   defect class that once scrambled transcript ordering. Now normalized via
   `toUtcIsoInstant` before parsing.

## Flaky note (pre-existing, out of scope)

`dashboard_summary.test.ts > done tasks are excluded from pastDeadlineCount`
failed once in a full serial run and passes in isolation both with and without
this branch. Nothing here touches the dashboard or task path. Same shared-state
ordering class the repo already documents on `PR_CHECKS` (#755/#1088).

## Next step

AJ: manual-smoke on a physical iPhone over the remote gateway and record #1379's
timing evidence (cold app start → first transcript open), then merge.

- Expected: session list, archived list, and transcript open are instant and
  survive a saturated or restarting engine, because reads no longer touch it.
- Still engine-dependent by design: sending, aborting, permission/question
  replies, the live event stream, and every working-tree read (`file.*`,
  `session.diff`, `vcs.*`, `find.*`, pty/shell).
- #1379 should stay open until the device timings are recorded; #1378 is fully
  covered by automated tests.

```bash
cd apps/api_server && npm run dev   # restart so the migration + mirror reads load
```
