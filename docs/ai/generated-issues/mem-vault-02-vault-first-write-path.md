# memory: `remember` writes a vault note FIRST, then updates the derived index

**Order:** 2 · **Depends on:** #1 (derived index) · **Milestone:** Memory vault as source of truth

## Why

Today `rhythm_remember_memory` → `POST /agent-memory` writes a DB row as the
authority. Per the decision doc the vault must be written first; the index is a
derivation. This issue makes the local `POST /agent-memory` write a markdown note to
the vault, then upsert the index.

## What

1. On `POST /agent-memory` (local agent server), the controller/service:
   - **Dedups** against existing notes — by frontmatter `id` if provided, else a
     normalized content key — to avoid duplicate notes.
   - **Writes the vault note first** via direct filesystem write (NOT the obsidian
     MCP) at `<MEMORY_VAULT_PATH>/memory/<kind>/<slug>.md` with frontmatter:
     `id` (assigned if absent), `kind`, `tags`, `created`, `updated`, `source`.
   - Then calls `MemoryIndexService.upsertNote(...)` so search reflects it immediately.
2. `DELETE /agent-memory/:id` removes the vault note (within the memory dir only) then
   removes the index row.
3. Confine all writes to the memory dir; reject paths that escape it.

## Acceptance criteria

1. A `POST /agent-memory` with `{kind, content}` creates a markdown file under the
   memory dir whose frontmatter validates (has `id`, `kind`, `created`, `updated`) and
   whose body equals `content`; the response returns the note id/path.
2. After the call returns, `GET /agent-memory/search?q=<term>` finds the new memory
   (index was updated synchronously).
3. **Dedup:** a second `POST` with the same `id` (or identical normalized content)
   updates the existing note in place (preserves `id` + `created`, bumps `updated`) and
   does NOT create a second file.
4. **Boundary:** a `kind` outside the allowed set
   (fact|person|project|preference|context) is rejected 4xx and writes nothing.
5. **Boundary / safety:** a content/name that would resolve a path containing `..` or an
   absolute path outside the memory dir is rejected 4xx and writes nothing.
6. `DELETE /agent-memory/:id` removes both the vault file and the index row; deleting a
   non-existent id is a safe 404, no file touched.

## Likely files

- `apps/api_server/src/controllers/agentMemoryController.ts`
- `apps/api_server/src/services/agentMemoryService.ts` (`remember`, `forget`)
- `apps/api_server/src/services/memory_index_service.ts` (from #1)
- `apps/api_server/src/routes/agentMemoryRoutes.ts`
- `apps/api_server/src/config/env.ts` (memory dir resolution)

## Required tests

- `apps/api_server/src/__tests__/memory_write_vault_first.test.ts` (new): note created
  with valid frontmatter; index updated; dedup-in-place; invalid kind rejected;
  path-escape rejected; delete removes file + row.

## Safety notes

- Vault-first ordering is mandatory: if the FS write fails, do not write the index.
- Direct FS only (must work with Obsidian closed).
- Confine writes/deletes to the memory dir (path-traversal guard).
- Never log note bodies.
