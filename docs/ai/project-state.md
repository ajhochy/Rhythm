# Project State

## Current focus

2026-07-29: restore production API deployability after merged `main`
(`0dcd826c7`) added an invalid Postgres foreign key from
`agent_sessions.project_id` to the intentionally SQLite-only `projects` table.
Production is healthy after rollback to `sha-80d1552`; the verified hotfix is
documented in
[runs/2026-07-29-postgres-project-fk-hotfix.md](runs/2026-07-29-postgres-project-fk-hotfix.md).

## Active branch / PR

- Branch: `codex/hotfix-postgres-project-fk`, based on `main` at `0dcd826c7`.
- PR: pending draft creation after commit, push, and branch CI.
- No production or Synology state is being changed from this branch.

## In progress

- Final diff review, commit, push, CI gate, and draft PR creation.
- Production remains deliberately pinned to the last known-good immutable image
  until the hotfix is reviewed, merged, and republished.

## Risks / known issues

- Running the normal Synology compose update without an explicit image override
  would select the currently broken `:main` image and restart the crash loop.
- A separate pre-existing `DB_CLIENT=postgres` + default `RHYTHM_ROLE=all`
  runtime error was found after healthy startup: stream status reconciliation
  calls the SQLite-only session repository. Follow-up:
  [postgres-all-role-stream-bridge-reconciliation.md](generated-issues/postgres-all-role-stream-bridge-reconciliation.md).
- The failed desktop release and the post-merge TestFlight build are tracked by
  the parallel release investigation; this hotfix does not alter desktop/mobile
  release assets.

## Test status

- GitNexus `runPostgresBootstrap` impact: LOW, one direct caller (`initDb`).
- Failure reproduced on disposable PostgreSQL 16 before the fix with exact
  `42P01 relation "projects" does not exist`.
- Normal-CI schema regression: 2 passed; env-gated live contract skipped.
- Live PostgreSQL contract after the fix: 1 passed, including two bootstrap
  runs, absent `projects`, no FK, nullable column, and logical-ID persistence.
- `ai-workflow checks --level issue`: all configured checks passed.
- `ai-workflow checks --level pr`: all Flutter, API, MCP, fork, and mobile
  checks passed.
- Fresh Postgres-backed API/fork sandbox: `/health` OK and
  `/opencode/health` ready.
- GitNexus compare-main change detection: LOW risk, zero affected indexed
  processes.

## Next step

Commit and push the hotfix, require green branch CI, and open a draft PR for
human review. After a human merges it and the corrected `:main` image publishes,
manually deploy that image on Synology and confirm `/health.commit` matches the
hotfix merge before removing the rollback pin.
