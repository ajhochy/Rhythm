---
date: 2026-06-24
tags: [decision, rhythm, api_server, migrations]
---

# Stale repo-local rhythm.db is not a migration bug

## Context

A report claimed that `agent_skills` and `agent_scheduled_tasks` (and possibly
`agent_cookbook`) did **not exist** in `rhythm.db`, despite their
`CREATE TABLE IF NOT EXISTS` statements being present in
`apps/api_server/src/database/migrations.ts` (~lines 1210 / 1274 / 1396) and the
migration runner (`runMigrations`) being invoked on every boot via
`src/database/db.ts:62`.

This was filed as a P0 blocker / likely defect in the migration runner
(suspected ordering, version guard, idempotency, or runner-not-invoked).

## Investigation (evidence)

1. **`runMigrations` is correct.** Running the current `runMigrations` against
   a **fresh** `:memory:` DB and against a **copy of the existing repo-local
   `rhythm.db`** both produced all three tables with no error. (Reproduced via
   a one-off `tsx` script; now locked in by `src/__tests__/migrations_self_heal.test.ts`.)
2. **The danger-zone is safe.** Every `ALTER TABLE` between the `agent_configs`
   CREATE (~802) and the three table CREATEs (1210+) is guarded by a
   `pragma table_info(...)` column-existence check — i.e. idempotent. There is
   no early `return`/`throw` in the main path of `runMigrations` that could
   abort before reaching the three CREATEs. `initDb` calls `runMigrations`
   without a try/catch, so an uncaught throw would crash startup — and the app
   runs, confirming no throw.
3. **The runtime DB is healthy.** The live runtime DB at
   `~/Library/Application Support/Rhythm/rhythm.db` (≈4.7 MB, modified today)
   **already contains** `agent_skills`, `agent_scheduled_tasks`, and
   `agent_cookbook`.
4. **The queried file is a stale artifact.** The repo-local
   `apps/api_server/rhythm.db` (≈372 KB) is **untracked** (`git ls-files` empty)
   and **gitignored** (`git check-ignore` matches). It was created by an older
   dev/test run before these tables were added to `migrations.ts` and was never
   re-opened by current code, so its schema froze. This is the file the report
   queried.

## Decision

- **No migration code change.** The migration runner is correct and
  self-healing; the three tables are created on every boot for any DB current
  code actually opens (fresh or pre-existing).
- **Add a regression guard** (`migrations_self_heal.test.ts`) asserting that
  `runMigrations` creates all three tables — with their intended columns — on
  (a) a fresh DB and (b) a populated DB from which the three tables were dropped
  (the stale-schema scenario). Also asserts idempotency on a second run. This
  fails loudly if a future edit reorders, over-guards, or early-returns past
  these CREATEs.
- **Do not commit the repo-local `rhythm.db`.** It is gitignored local data
  (CLAUDE.md hard rule). To refresh it, point the dev server at it once — boot
  runs `runMigrations` and self-heals the schema. No hand-created tables.

## Alternatives considered

- *Hand-create the three tables in the stale DB.* Rejected — masks the real
  (non-)cause, risks committing local data, and the report explicitly asked for
  a root-cause fix, not a manual table creation.
- *Add a version-numbered migration ledger.* Out of scope for this run; the
  existing `CREATE TABLE IF NOT EXISTS` + guarded-`ALTER` pattern is already
  idempotent. Noted as a possible future hardening.

## Consequences

- Future agents who see "table missing in `apps/api_server/rhythm.db`" should
  first check the **runtime** DB and confirm the file isn't the stale
  gitignored artifact before suspecting the migration runner.
- The regression test documents the intended self-heal contract for these
  three tables.
