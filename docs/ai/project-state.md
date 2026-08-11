# Project State

## Current focus

Issues #1243–#1246 are implemented together on the tasks workstream: first-class goals, task priority/tags, rhythm/task dopamine cues with energy ordering, and project-instance milestones.

## Active branch / PR

- Branch: `mega-ws/tasks`; implementation commit `25e069c2` is on top of starting commit `c588f15a`.
- PR: none. The mandate explicitly forbids pushing.

## In progress

- A socket-capable orchestrator must run the env-gated live HTTP tests and native Flutter visual smoke.

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

Run the exact gates and live/native smoke in a socket-capable environment. Do not push until requested.
