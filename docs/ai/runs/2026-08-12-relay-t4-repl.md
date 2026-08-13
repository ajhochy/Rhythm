---
date: 2026-08-12
repo: Rhythm
branch: relay/t4-repl
pr: null
issues: []
status: blocked-verification
tags: [run, Rhythm]
---

# Relay Track 4 — Phase 2 replication

## Files

- Added the SQLite relay outbox/sync-state schema and outbox repository.
- Added same-transaction mirror hooks for session/message mutations, with
  `applyPartDelta` deliberately excluded.
- Added Mac replay/live flush/ack pruning, relay idempotent row application,
  cumulative ack state, resync callbacks, bridge ordering, and additive relay
  SSE reconnect handling.

## Checks

- `cd apps/api_server && npx tsc --noEmit` — exit 0.
- Non-socket Track 4 contract selection (`session insert/reconcile`, inert
  hooks, bridge source order) — 3 passed.
- Relay-role env selection — 3 passed.
- Migration replay/self-heal and session repository regression suites — 28
  passed.
- Direct no-listener behavioral probes passed for verbatim transactional
  outbox writes/rollback/no-echo, 501-row ordered replay + pruning, and relay
  apply/idempotence/sync-state/whitelist/resync notification.
- `git diff --check` — exit 0.

## Notes

- The managed sandbox rejects all listener binds (`listen EPERM` for both
  `127.0.0.1` and `0.0.0.0`), so the socket-backed Track 1/4 suites could not
  execute here.
- The locked Track 4 message-hook case converts the UUID returned by
  `AgentSessionsRepository.insert()` with `Number(sessionPk)`. That produces
  `NaN`, which better-sqlite3 binds as `NULL` and correctly fails the
  `agent_session_messages.session_id NOT NULL` constraint. The locked test was
  not modified; it should pass `sessionPk` verbatim.
- The relay-applier contract case sends `ctrl/resync-done` before its replay
  rows, opposite the documented rows-then-done protocol. The implementation
  tolerates that order, but the test should be corrected by its owner.
