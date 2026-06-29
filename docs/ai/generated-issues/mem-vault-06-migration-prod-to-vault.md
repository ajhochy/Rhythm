# memory: one-time migration of existing prod `agent_memory` rows into vault notes

**Order:** 6 · **Depends on:** #1 (index), #2 (vault write path) · **Milestone:** Memory vault as source of truth

## Why

Before prod `agent_memory` is treated as dormant, existing memories already written to
prod Postgres (owner-scoped, via the old MCP→prod path) must be exported into the vault
so nothing is lost. This is a one-time, idempotent, opt-in operation.

## What

1. Add a `MemoryMigrationService` (new
   `apps/api_server/src/services/memory_migration_service.ts`) that reads prod
   `agent_memory` rows **for the signed-in user only** (owner-scoped) and writes each as
   a vault note via the #2 write path (so dedup + index happen automatically).
2. Expose it as an explicit, opt-in trigger — a one-shot route (e.g.
   `POST /agent-memory/migrate-from-prod`) or a CLI/script — never automatic on boot.
3. Make it idempotent: re-running maps existing rows to existing notes by a stable key
   (frontmatter `id` derived from the prod row id or content) and updates in place.

## Acceptance criteria

1. Given prod rows for the current user, running the migration produces one vault note
   per row with correct kind/content/tags, and corresponding index rows.
2. **Idempotent:** running it a second time creates no duplicate notes (updates in place).
3. **Owner scope:** only the signed-in user's rows are exported — never other users' rows.
4. **Empty/no prod:** migration is a safe no-op when there are no rows or prod is unreachable
   (logs a clear message, exits 0).
5. Migration is NOT triggered automatically on server start.

## Likely files

- `apps/api_server/src/services/memory_migration_service.ts` (new)
- `apps/api_server/src/routes/agentMemoryRoutes.ts` (one-shot route) or a `scripts/` entry
- `apps/api_server/src/repositories/agent_memory_repository.ts` (read-only `listAsync` use)
- `apps/api_server/src/services/agentMemoryService.ts` (reuse `remember`/write path)

## Required tests

- `apps/api_server/src/__tests__/memory_migration.test.ts` (new): rows→notes round-trip;
  re-run is a no-op; owner-scoping enforced; empty source no-op.

## Safety notes

- **Owner-scoped read only** — must not exfiltrate other users' memories.
- Opt-in / explicit trigger only; never auto-run (avoids surprise prod reads).
- Does not delete prod rows (prod left dormant; a later cleanup PR handles removal).
- Never log note bodies.
