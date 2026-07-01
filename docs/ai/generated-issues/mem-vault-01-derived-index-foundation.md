# memory: treat SQLite `agent_memory` as a disposable derived index + rebuild-from-vault

**Order:** 1 · **Depends on:** none · **Milestone:** Memory vault as source of truth

## Why

The vault becomes the single source of truth (see
`docs/ai/decisions/2026-06-28-memory-vault-as-source-of-truth.md`). The local
SQLite `agent_memory` + `agent_memory_fts` store must be re-cast as a **disposable
cache** that can be rebuilt from a full vault scan at any time. This issue lays that
foundation before any write or injection change depends on it.

## What

1. Add a `MemoryIndexService` (new `apps/api_server/src/services/memory_index_service.ts`)
   that owns the derived index. It wraps `AgentMemoryRepository` and adds:
   - `rebuildIndexFromVault(vaultPath?)` — clears the index and repopulates it from
     a full recursive scan of the vault (reuse `memoryVaultSyncService`'s frontmatter
     parser; do not duplicate parsing logic).
   - `upsertNote(parsedNote)` / `removeNote(sourceId)` — incremental index ops used
     by later issues.
2. Document in code (and a one-line migration comment) that the SQLite `agent_memory`
   table is **derived/disposable** — no behavior change to the DDL, but the intent is
   recorded so future readers don't treat it as authoritative.
3. Keep the existing `searchAsync` semantics intact (FTS5 MATCH + LIKE fallback).

## Acceptance criteria

1. Calling `rebuildIndexFromVault(tmpVault)` against a temp vault of N notes leaves
   exactly N rows in `agent_memory`, each matching the note's parsed kind/content/tags.
2. **Idempotent:** running `rebuildIndexFromVault` twice in a row yields identical rows
   (same count, same content) — no duplicates.
3. **Rebuildable guarantee (seed for issue 7):** after a rebuild, deleting all index
   rows and rebuilding again reproduces the same `searchAsync(query)` top-N results.
4. **Boundary:** a missing/empty vault path is a no-op (zero rows touched), not an error.
5. No change to the Postgres path; `postgres_bootstrap.ts` is untouched.

## Likely files

- `apps/api_server/src/services/memory_index_service.ts` (new)
- `apps/api_server/src/services/memoryVaultSyncService.ts` (reuse `parseNote`; export it if not already)
- `apps/api_server/src/repositories/agent_memory_repository.ts` (read-only use; maybe expose a `clearAllAsync`)
- `apps/api_server/src/database/migrations.ts` (comment only — additive marker, no schema change)

## Required tests

- `apps/api_server/src/__tests__/memory_index_rebuild.test.ts` (new): rebuild count,
  idempotence, drop+rebuild reproducibility, empty-vault no-op.
- Existing `memory_vault_sync*.test.ts` must still pass.

## Safety notes

- SQLite migrations **additive only**; do not alter or drop existing columns/indexes.
- Do not touch the Postgres DDL (`postgres_bootstrap.ts`) — prod parity must hold.
- Never log note bodies (private memory).
