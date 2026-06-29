# memory: injection reads the derived index; cron + file-watch keep it fresh from vault edits

**Order:** 4 · **Depends on:** #2 (write path) · recommended after #3 · **Milestone:** Memory vault as source of truth

## Why

Per-prompt injection (`getRelevantMemories` / `buildMemoryPreface` in
`memory_retrieval.ts`, called from `agent_runner.ts` and `ws_gateway.ts`) must read the
**derived index** and work even when Obsidian is closed. User edits made directly in
Obsidian must also flow into the index. #770's cron (`*/10 * * * *`) already does a
periodic vault→index pass; this issue points injection at the index and adds prompt
freshness via the index rebuild/file-watch.

## What

1. Ensure `getRelevantMemories` reads through the derived index (`MemoryIndexService`),
   and that each returned memory carries its **vault note path** (so results trace back
   to a file). Keep tokenization, top-N (default 5), and the toggle
   `AGENT_MEMORY_INJECTION_ENABLED` behavior.
2. On local agent server startup, call `rebuildIndexFromVault()` (from #1) so a fresh
   boot has a correct index without waiting for the cron.
3. Refresh on user edits: keep the existing cron re-index; optionally add a debounced
   filesystem watch on the memory dir that re-indexes changed/added/removed notes.
   The watch must **ignore the index DB's own writes** and debounce to avoid loops.

## Acceptance criteria

1. Immediately after a `rhythm_remember_memory` write, the next call to
   `buildMemoryPreface(matchingQuery)` includes that memory — sourced from the index,
   not a fresh vault scan.
2. **Obsidian-closed:** injection returns results with the obsidian REST plugin
   unavailable (proves index-only, direct-FS path).
3. **User edit:** a note edited directly on disk (new body) is reflected in injection
   after a re-index pass (cron tick or watch event) — the index re-derives from the file.
4. **Deletion:** a note removed on disk is gone from injection results after re-index.
5. Toggling `AGENT_MEMORY_INJECTION_ENABLED=false` still disables injection (unchanged).
6. Returned memory objects expose the originating note path.

## Likely files

- `apps/api_server/src/services/memory_retrieval.ts`
- `apps/api_server/src/services/memory_index_service.ts` (from #1)
- `apps/api_server/src/jobs/memory_vault_sync_job.ts` (cron re-index; optional watch)
- `apps/api_server/src/server.ts` (startup rebuild call)
- `apps/api_server/src/services/agent_runner.ts` / `services/ws_gateway.ts` (no logic change expected; verify path)

## Required tests

- `apps/api_server/src/__tests__/memory_injection_index.test.ts` (new): write→recall;
  index-only recall (no vault rescan); on-disk edit reflected after re-index; deletion
  reflected; toggle off; note path present.
- Existing `memory_injection*.test.ts` must still pass.

## Safety notes

- Injection prefaces are transient/in-memory (unchanged) — do not persist them.
- File-watch must debounce and ignore self-writes (no rebuild storms).
- Never log note bodies in the injection path.
