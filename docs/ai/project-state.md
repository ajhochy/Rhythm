# Project State

## Current focus

Issues #1243–#1246 are implemented together on the tasks workstream: first-class goals, task priority/tags, rhythm/task dopamine cues with energy ordering, and project-instance milestones.

## Active branch / PR

- Branch: `mega-ws/tasks` at starting commit `c588f15a9bcac9af9224c3285e9d6ed3acd57221`.
- PR: none. The mandate explicitly forbids pushing.
- Commits are blocked in this managed sandbox because the worktree gitdir is under the read-only main checkout (`.git/worktrees/ws-tasks`).

## In progress

- A socket-capable orchestrator must run the env-gated live HTTP tests and native Flutter visual smoke.
- The intentional worktree changes must be committed once git metadata is writable.

## Risks / known issues

- Normal API/Flutter suites include socket-bound tests that cannot bind loopback in this sandbox (`EPERM`).
- The Flutter wrapper cannot update its external SDK cache; direct Dart format/analyze succeeds with a temporary writable HOME.
- Native screenshots and real sandbox behavior remain unverified here, so verification-gate cannot issue a PASS.
- Never start a bare `api_server`; use `tools/dev/sandbox.sh` in a suitable environment.

## Test status

- Focused API contracts: 17 passed, 5 env-gated live tests skipped.
- API TypeScript compilation: passed.
- Full direct Dart analysis: no errors or warnings; 209 pre-existing infos.
- SQLite/Postgres parity audit found goals, goal links, priority, JSON tags, energy, milestones, and milestone links in both migration paths.
- Full API and Flutter gates are blocked by sandbox socket/cache restrictions; see `docs/ai/runs/2026-08-10-task-goals-tags-dopamine-milestones.md`.

## Next step

Run the exact gates and live/native smoke in a socket-capable environment, then commit the four logical units on `mega-ws/tasks` without pushing.
