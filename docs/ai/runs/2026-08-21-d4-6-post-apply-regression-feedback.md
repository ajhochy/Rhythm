---
date: 2026-08-21
repo: Rhythm
branch: agent-stack/si-d4-1444-regression-terra
pr: null
issues: [1444]
status: pass
tags: [run, rhythm, d4]
index: "[[Rhythm]]"
---

# D4.6 — post-apply regression feedback

## Files changed

- Canonical trust query now combines fixed-horizon experiment regress decisions with distinct successful D2 auto-revert event identities, excluding the same proposal if its experiment already decided `regress`.
- Trust singleton persistence atomically makes a non-zero regression monotonic, ineligible, disabled, and un-timestamped on SQLite and Postgres.
- Successful D2 auto-reverts refresh trust after the terminal event commit and write one sanitized, idempotent user notification for the proposal owner/decider. Notification delivery failures are logged with a fixed safe message and cannot undo the event or trust update.
- Added focused SQLite integration coverage and an env-gated, loopback-only Postgres repository/bootstrap contract.

## Checks run

- RED: `cd apps/api_server && npx vitest run src/services/__tests__/post_apply_regression_feedback.test.ts --no-file-parallelism` — 5 expected assertion failures before implementation (missing D2 tally, retry safety, disablement, and alert behavior).
- Focused D2/D4 matrix: `npx vitest run src/services/__tests__/post_apply_regression_feedback.test.ts src/services/__tests__/post_apply_lifecycle.integration.test.ts src/services/__tests__/auto_repair_service.test.ts src/services/__tests__/auto_revert_service.test.ts src/services/__tests__/trust_counter_service.test.ts src/repositories/promotion_trust_state_repository.test.ts src/repositories/__tests__/agent_org_experiments_repository.test.ts src/repositories/__tests__/post_apply_events_repository.test.ts src/__tests__/notifications.test.ts src/__tests__/promotion_trust_state_schema_parity.test.ts src/__tests__/migrations_replay_guard.test.ts --no-file-parallelism` — 11 files, 96 tests passed.
- Disposable Postgres: `RHYTHM_LIVE_PG=1 ... npx vitest run src/__tests__/post_apply_regression_feedback_live_postgres.test.ts src/__tests__/live_postgres_bootstrap.test.ts --no-file-parallelism` — 2 files, 11 tests passed. Used only a loopback Docker PostgreSQL 16 container on port 55434; container removed afterward.
- Node 22 static/build: `npx tsc --noEmit && npm run build` — passed.

## Notes

- GitNexus impact/detect is UNKNOWN: no GitNexus tools are available in this worktree. Direct caller inspection covered `runAutoRevertAsync`, `recordTrustCountersAsync`, `recordEligibilityAsync`, and `getTrustLedgerCountsAsync`.
- No HTTP, WebSocket, or MCP surface changed. D4.6 is the existing local D2 post-commit service composition, so no new sandbox server behavior was required.
- Re-enablement is intentionally absent. A future D4.2 endpoint can read the durable non-zero regression count and refuse an implicit enable; only an explicit separate opt-in may be designed later.

## D4.6 repair after parent review (2026-08-21)

- The terminal `reverted` event now has a durable, derived reconciliation path: the bounded SQLite D2 scheduler selects it only while trust remains enabled/eligible or behind the canonical regression ledger, or its resolved recipient lacks the idempotent regression-disable notification. Re-entry calls that reconciliation without replaying the target revert.
- Recipient resolution accepts only an existing positive owner/decider ID; a system-owned proposal falls back deterministically to the earliest positive-id `admin` or `system` user. With no valid user, notification delivery stays derivably retryable. The static notification payload and `insertOnceAsync` uniqueness semantics are unchanged.
- Focused Node 22 D2/D4 SQLite matrix: `npm exec -- vitest run src/services/__tests__/post_apply_regression_feedback.test.ts src/services/__tests__/post_apply_lifecycle.integration.test.ts src/services/__tests__/auto_repair_service.test.ts src/services/__tests__/auto_revert_service.test.ts src/services/__tests__/trust_counter_service.test.ts src/repositories/promotion_trust_state_repository.test.ts src/repositories/__tests__/agent_org_experiments_repository.test.ts src/repositories/__tests__/post_apply_events_repository.test.ts src/__tests__/notifications.test.ts src/__tests__/promotion_trust_state_schema_parity.test.ts src/__tests__/migrations_replay_guard.test.ts --no-file-parallelism` — 11 files, 99 tests passed. The added cases cover one-time trust-write failure, one-time notification-write failure, system actor `0`, no-user deferral, and repeated sweeps/re-entry.
- Node 22: `npm exec -- tsc --noEmit && npm run build` — passed. Disposable loopback Postgres: `RHYTHM_LIVE_PG=1 RHYTHM_LIVE_PG_URL=postgres://probe:probe@127.0.0.1:55435/probe DB_CLIENT=postgres DB_HOST=127.0.0.1 DB_PORT=55435 DB_NAME=probe DB_USER=probe DB_PASSWORD=probe npm exec -- vitest run src/__tests__/post_apply_regression_feedback_live_postgres.test.ts src/__tests__/live_postgres_bootstrap.test.ts --no-file-parallelism` — 2 files, 11 tests passed; exact temporary container `rhythm-d4-1444-pg` was removed. An initial invocation omitted the `DB_*` settings and failed harmlessly before executing the D4.6 test, attempting only loopback `:5432`.
