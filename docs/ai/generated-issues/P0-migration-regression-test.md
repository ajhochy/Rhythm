# P0 — Migration regression test + stale-DB finding documentation

**Labels:** `test`, `api-server`, `database`, `p0`
**Depends on:** none (independent — run in parallel with P3)

## Context / Background

The three tables `agent_skills`, `agent_scheduled_tasks`, and `agent_cookbook` already migrate correctly on every boot. `runMigrations` is called unconditionally in `db.ts:62` on every server startup using guarded `CREATE TABLE IF NOT EXISTS` + guarded `ALTER TABLE` statements. The runtime DB at `~/Library/Application Support/Rhythm/rhythm.db` has all three tables.

The failure report that prompted this issue queried the **stale, untracked, gitignored repo-local `apps/api_server/rhythm.db`** — a dev artifact that is created on first local `npm run dev` but never re-migrated when new tables are added. It is not the runtime DB. This is a documentation + regression-lock issue, NOT a bug fix.

Deliverables:
1. New vitest `src/__tests__/migrations_self_heal.test.ts` asserting migrations are self-healing on fresh AND pre-existing DBs.
2. New decision note `docs/ai/decisions/2026-06-24-stale-local-rhythm-db.md` documenting the trap.

## Likely Files

- `apps/api_server/src/database/migrations.ts` — `runMigrations` export at line 3; `agent_scheduled_tasks` creation at ~1210; `agent_skills` creation at ~1274; `agent_cookbook` creation at ~1396. **Read-only** in this issue.
- `apps/api_server/src/__tests__/migrations_self_heal.test.ts` — **new file** (the only write target in `apps/api_server/`).
- `docs/ai/decisions/2026-06-24-stale-local-rhythm-db.md` — **new file** (decision note).
- `apps/api_server/src/database/db.ts` — read-only reference to confirm `runMigrations` call at line ~62.

## Acceptance Criteria

- [ ] `migrations_self_heal.test.ts` passes: `runMigrations` called on a fresh `:memory:` SQLite DB produces `agent_skills`, `agent_scheduled_tasks`, and `agent_cookbook` tables, each with their intended columns (at minimum: `id`, `created_at` for all three; `prompt` for `agent_cookbook`; `title` + `body` for `agent_skills`; `cron_expression` for `agent_scheduled_tasks`).
- [ ] `migrations_self_heal.test.ts` passes: `runMigrations` called on a `:memory:` DB pre-seeded with the OLD schema (tables absent) also produces all three tables afterward — no throw.
- [ ] `migrations_self_heal.test.ts` passes: a second call to `runMigrations` on an already-migrated DB is idempotent — no error, no data loss.
- [ ] `docs/ai/decisions/2026-06-24-stale-local-rhythm-db.md` exists with: Context (what the stale file is, why it exists), Decision (never commit it; never query it to assert migration status), Consequences (new table verifications must use `:memory:` or the runtime DB path, not the repo-local artifact), and a note that `apps/api_server/rhythm.db` must remain gitignored and unstaged.
- [ ] `git status` shows `apps/api_server/rhythm.db` remains untracked — it is never staged or committed.
- [ ] `tsc --noEmit` passes with zero errors.

## Required Tests

New file `apps/api_server/src/__tests__/migrations_self_heal.test.ts`:
```
describe('runMigrations self-healing', () => {
  it('fresh :memory: DB has all three tables with expected columns')
  it('DB missing all three tables gets them created by runMigrations')
  it('second runMigrations call is idempotent')
})
```
Use `better-sqlite3` directly — same import pattern as other `__tests__` files. No mocking needed (migrations.ts has no external deps).

## Dependencies

None. Can run in parallel with P3.

## Safety Notes

- **NEVER** stage or commit `apps/api_server/rhythm.db`. Confirm with `git status` before every commit in this issue.
- The test uses `:memory:` only — no filesystem DB files are created or read.
- No schema changes — `migrations.ts` is read-only in this issue.
- No Flutter changes required.
