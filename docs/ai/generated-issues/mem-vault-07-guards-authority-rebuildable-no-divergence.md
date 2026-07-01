# memory: guards — vault is sole authority, index is rebuildable, prod boot intact

**Order:** 7 · **Depends on:** #1–#6 · **Milestone:** Memory vault as source of truth

## Why

The decision doc makes two promises that must be machine-checked so they can't silently
regress: (a) the index is **rebuildable and disposable** (drop it, rebuild, identical
results), and (b) the vault is the **only authority** (no second store wins). Plus the
don't-break-prod constraint: prod `/agent-memory` must keep responding and the Postgres
DDL must be untouched. This issue adds those guards.

## What

1. **Rebuildable guard:** a test that writes notes, captures `searchAsync` top-N, drops
   all index rows, calls `rebuildIndexFromVault()`, and asserts identical top-N.
2. **Sole-authority guard:** a test asserting the vault file is authoritative — editing a
   note on disk and re-indexing changes results; there is no path by which a stale DB row
   survives a vault deletion after re-index.
3. **Don't-break-prod guard:** assert prod `agent_memory` DDL in `postgres_bootstrap.ts`
   is unchanged and prod `/agent-memory` routes still respond (dormant, not removed); a
   smoke script (`smoke_memory_authority.sh`) that boots the local server, writes via the
   tool, confirms a vault note + index row, drops + rebuilds the index, and confirms
   identical recall.
4. **No-divergence check:** confirm there is exactly one programmatic writer (the local
   agent server) and that the Flutter UI + MCP tools both resolve to `:4001`.

## Acceptance criteria

1. Drop-index → rebuild → identical `searchAsync` top-N (rebuildable proven).
2. On-disk note delete + re-index → memory gone from injection (no stale authority).
3. `postgres_bootstrap.ts` `agent_memory` DDL is byte-unchanged from main; prod
   `/agent-memory` GET still returns 200 (dormant route intact).
4. SQLite migrations remain additive (no dropped/altered columns) — asserted or reviewed.
5. `smoke_memory_authority.sh` passes end-to-end against the local server.
6. A check (test or grep-based) confirms memory tools + Flutter memory data source both
   target `localhost:4001` — no prod coupling.

## Likely files

- `apps/api_server/src/__tests__/memory_index_rebuild.test.ts` (extend from #1)
- `apps/api_server/src/__tests__/memory_vault_authority.test.ts` (new)
- `apps/api_server/scripts/smoke_memory_authority.sh` (new) — wire into release CI like `smoke_skill_alignment.sh`
- `apps/api_server/src/database/postgres_bootstrap.ts` (read-only assertion target)

## Required tests

- The two test files above + the smoke script are the deliverable for this issue.

## Safety notes

- Smoke must run only against the **local** server (:4001); never against prod.
- Smoke must not write to or read prod; use a temp vault + temp SQLite.
- Never log note bodies; the smoke asserts presence by id/path, not content dump.
