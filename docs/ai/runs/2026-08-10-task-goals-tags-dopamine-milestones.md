---
date: 2026-08-10
repo: Rhythm
branch: mega-ws/tasks
pr: null
issues: [1243, 1244, 1245, 1246]
status: blocked
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# Task, goal, dopamine, and milestone workstream

## Files changed

- API: additive SQLite/Postgres schema, goal and milestone APIs, task organization/energy, dashboard rollup, project grouping, and live/contract tests.
- Flutter: layered goals and milestone clients; Dashboard/rhythm donuts; task filters, metadata, affirmation, energy ordering; project milestone timeline.
- Contracts: `docs/ai/contracts/issue-1243.json` through `issue-1246.json`.

## Checks run

- `./node_modules/.bin/tsc --noEmit` — passed after the final API implementation.
- Focused issue contracts — 17 passed; five live-only tests skipped without `RHYTHM_LIVE_E2E=1`.
- Direct Dart format across `lib` and contract tests — passed.
- Direct Dart analyze across `lib` and contract tests — no errors/warnings; 209 existing infos.
- Schema parity audit — both migration files contain goals, goal links, priority, JSON tags, energy, project milestones, and milestone links.
- `npm test` — attempted; socket/process suites failed or timed out because loopback bind is denied (`EPERM`), then the run was stopped after establishing the environmental pattern.
- Live tests and visual screenshots — not run because this worker cannot bind sockets or launch the native app.

## Notes

- Goal progress uses a clamped `(current-start)/(end-start)` ratio.
- Tags are normalized JSON string arrays with exact membership filtering; priority uses a minimum threshold.
- Explicit weekly ordering remains authoritative; otherwise energy ranks `🔥`, `⚡`, `🌱`, then unset/unknown.
- Milestones are deliberately compact and instance-scoped. Steps remain valid when ungrouped; deleting a milestone unsets its step links.
- SQLite legacy databases use additive guard triggers for same-instance milestone integrity because SQLite cannot add a composite foreign key without rebuilding the table. Fresh SQLite and Postgres schemas use the composite relationship.
- The initial commit attempt was denied while the worktree gitdir was read-only. A final retry succeeded; implementation is recorded in `25e069c2`. No push was attempted.
