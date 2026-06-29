---
date: 2026-06-28
repo: Rhythm
tags: [decision, Rhythm]
index: "[[Rhythm]]"
---

# Agent memory: the Obsidian vault is the source of truth (local-first); the DB becomes a disposable derived index

## Context

Agent "memory" (facts, preferences, people, projects, context the agent should
recall across sessions) is today stored in a **database**, not the vault, and the
topology is split across two stores that the agent and the UI never agree on:

- **Store today is the DB.** `agent_memory` table exists in both SQLite
  (`apps/api_server/src/database/migrations.ts:1242-1268`, external-content FTS5
  virtual table `agent_memory_fts`) and Postgres
  (`apps/api_server/src/database/postgres_bootstrap.ts:543-560`, `tsvector`
  generated column + GIN index). Repo:
  `apps/api_server/src/repositories/agent_memory_repository.ts`
  (`searchAsync`, `createAsync`, `upsertBySourceAsync` dedup keyed on
  `(source, source_id)`, `owner_user_id`-scoped). Service
  `services/agentMemoryService.ts`; retrieval `services/memory_retrieval.ts`
  (`getRelevantMemories` → tokenize query, owner-scoped top-5,
  `buildMemoryPreface`); injection in `services/agent_runner.ts` (owner-scoped)
  and `services/ws_gateway.ts` (always null-owner / instance-global). Toggle
  `AGENT_MEMORY_INJECTION_ENABLED`.

- **The MCP write path goes to PROD.** The agent's memory tools live in
  `apps/mcp_server/src/tools/agentMemory.ts` (`rhythm_remember_memory` → `POST
  /agent-memory`, `rhythm_search_memory` → `GET /agent-memory/search`,
  `rhythm_list_memories`, `rhythm_forget_memory`). They call `RHYTHM_API_URL`,
  which `index.ts:22` defaults to `https://api.vcrcapps.com` and which the desktop
  app sets to `serverConfig.url` = the **production** server
  (`settings_view.dart:862`; also written into `opencode.json` by
  `opencode_client_service.ts:1627` / `opencode_mcp_routes.ts:199`). So **live
  agent memories are written to prod Postgres, owner-scoped.**

- **But the Flutter memory UI reads the LOCAL server.** `agent_memory/data/
  agent_memory_data_source.dart:10` targets `AppConstants.agentLocalBaseUrl`
  (`http://localhost:4001`). The same `/agent-memory*` routes therefore resolve
  to **two different stores**: the agent (via MCP) writes prod Postgres; the
  desktop UI reads/writes local SQLite. They never see each other's memories.
  **This is the core disconnect.**

- **The #770 vault attempt is one-way and DB-centric.** Commit `2e83d0cc1` added
  `services/memoryVaultSyncService.ts` + `jobs/memory_vault_sync_job.ts`: a
  cron (`*/10 * * * *`) + `POST /agent-memory/sync` + on-startup mirror that
  reads `~/Documents/Memory-Vault/*.md` (via `resolveMemoryVaultPath()` /
  `MEMORY_VAULT_PATH` in `config/env.ts`), parses frontmatter
  (kind/tags/source/source_id/created/updated + body), upserts rows
  `source='obsidian-memory'` `source_id=<vault-relative path>`, and tombstones
  deleted files. It is a **one-way vault→DB mirror with NO write-back** — the DB
  is still treated as the authority that injection reads from, and programmatic
  `remember` still writes the DB (on prod), never the vault. Direct filesystem,
  not the obsidian MCP. Tests: `__tests__/memory_vault_sync*.test.ts`.

- **Consolidation is broken.** `agentMemoryService.seedConsolidationTask()` seeds
  a daily task whose prompt references a `rhythm_list_sessions` MCP tool that
  **does not exist** anywhere (`grep` across `apps/mcp_server/src` confirms no
  session-reading tool). The consolidation cannot read sessions today.

- **Precedent / warning.** `AGENTS.md` and `CLAUDE.md` record that
  `obsidian_post_file` session logging was **retired** for creating a divergent
  second log; `docs/ai/` is now the single source of truth. Any DB+vault split
  re-creates exactly that divergence risk unless the derived side is
  unambiguously disposable.

**Maintainer decision (locked, 2026-06-28):** the vault is **home**, local-first,
per-device. Multi-device sync (if wanted) is the user's responsibility via
Obsidian Sync / iCloud / git — not ours. This matches the dual-endpoint principle
that agent data is local and owned by the local agent server (`:4001`).

## Decision

**The Obsidian vault on the user's machine is the single source of truth for agent
memory. A local SQLite FTS index, owned by the local agent server (`:4001`), is a
disposable derivation of the vault — rebuilt from the vault on demand and never an
independent authority. The prod `agent_memory` store is deprecated.**

Concretely:

1. **Vault layout & schema.** Memory notes live under a dedicated memory folder in
   the vault (default `~/Documents/Memory-Vault/`, override `MEMORY_VAULT_PATH`;
   recommend a `memory/` subfolder with per-kind subfolders
   `memory/<kind>/<slug>.md` so user browsing in Obsidian is sane). Frontmatter
   schema (superset of #770's, plus a stable id):

   ```yaml
   ---
   id: mem-<ulid>          # stable dedup identity; assigned on first write
   kind: fact|person|project|preference|context
   tags: [..]              # optional
   created: 2026-06-28T...Z
   updated: 2026-06-28T...Z
   source: agent|user|consolidation   # who authored it (informational)
   ---
   <markdown body = the memory content>
   ```

   The note **file path is the source_id** for the index (as #770 already does);
   `id` in frontmatter is the durable dedup key the write path uses.

2. **Write path (vault first).** `rhythm_remember_memory` → an endpoint on the
   **local** agent server that (a) dedups against existing notes by frontmatter
   `id` or a normalized content key, (b) writes/updates a `SKILL.md`-style markdown
   note in the vault **first** via direct filesystem write (works whether or not
   Obsidian is running), then (c) upserts the derived index row. The local agent
   server is the **single writer** for all programmatic writes.

3. **Derived index (search/injection).** A local SQLite FTS index (reuse the
   existing `agent_memory` + `agent_memory_fts` SQLite schema, but mark it
   explicitly derived/disposable) is: rebuilt from a full vault scan on startup;
   updated incrementally on each programmatic write; and refreshed by the existing
   cron / a file-watch to catch edits the user makes directly in Obsidian.
   `getRelevantMemories` / `buildMemoryPreface` read this index unchanged; results
   carry the vault note path so they trace back to the file.

4. **Topology re-route (the key fix).** Memory MCP tools must hit the **local agent
   server (`:4001`)**, not `serverConfig.url`/prod — mirroring how agent
   *sessions* already hard-code `localhost:4001` (`AppConstants.agentLocalBaseUrl`)
   regardless of the Settings URL. Implement by giving the memory tools their own
   base env var (e.g. reuse `RHYTHM_AGENT_URL`, already `http://localhost:4001`,
   which `notifications`/`agentDelegation` tools already use) instead of
   `RHYTHM_API_URL`. Flutter's `agent_memory_data_source` already points at
   `:4001`, so the UI and the agent converge on **one** store.

5. **Consolidation + session-read tool.** Consolidation writes its distilled facts
   as **vault notes** (via the same local write endpoint), not prod DB rows. The
   missing `rhythm_list_sessions` capability is filled by a new MCP tool backed by
   the existing local `GET /agent-sessions` (+ `/:id/messages`) endpoints so the
   consolidation skill's step 1 can actually read sessions.

6. **Concurrency / conflict.** Single writer = the local agent server for all
   programmatic writes. User edits in Obsidian flow in via file-watch/cron
   re-index. Conflict policy is **last-write-wins at the file level**; the index
   always re-derives from files, so the file is authoritative and the index can
   never "win" over a user edit. No two-way merge is attempted.

7. **Migration + prod fate.** A one-time export reads existing
   prod `agent_memory` rows (owner-scoped to the signed-in user) and materializes
   each as a vault note, so nothing is lost. After migration the prod
   `/agent-memory` routes and Postgres table are **left dormant, not dropped**
   (keep `postgres_bootstrap.ts` intact so prod boot never breaks) and marked
   deprecated; a later cleanup PR may remove them once confirmed unused.

8. **Owner-scoping collapses.** On a local-first single-user machine the local
   store has exactly one user. `owner_user_id` is retained in the SQLite schema for
   continuity but the local write path stamps a single local owner (or null) and
   retrieval no longer needs cross-user isolation. Vault subfolders, not
   `owner_user_id`, are the human-facing organization.

### Filesystem vs obsidian MCP — recommendation

**Use direct filesystem read/write, not the Obsidian Local REST API MCP.** The
index must be fast and **always available even when Obsidian is not running**
(per-prompt injection happens on every agent turn); the obsidian REST plugin only
responds while Obsidian is open. #770 already uses direct FS and it works. The
obsidian MCP remains useful for the *user's* interactive browsing but is not on the
agent's hot path.

### Divergence guarantee

There is exactly one authority: the vault files. The SQLite index is rebuildable
from a full vault scan and is treated as a cache — deleting it and restarting must
reproduce identical search results. A smoke test asserts this (drop index → rebuild
→ same top-N). This is the explicit guard against repeating the `obsidian_post_file`
divergence.

## Alternatives considered

- **Prod DB stays home (status quo, rejected by maintainer).** Keep `agent_memory`
  in prod Postgres as the authority; vault is just a mirror. Rejected: it is the
  current broken topology — the agent writes prod, the UI reads local, they never
  reconcile; memory is not local-first; and it couples private agent memory to a
  hosted multi-tenant store against the dual-endpoint principle.

- **Synced vault as a first-class multi-device store (rejected by maintainer).**
  Build sync/merge so memory follows the user across machines. Rejected as
  out-of-scope: the maintainer owns multi-device via Obsidian Sync/iCloud/git;
  building conflict-free replicated merge here is large surface area for no current
  need. Memory is explicitly per-device.

- **Obsidian REST API (MCP) as the read/write path (rejected).** Cleaner Obsidian
  integration, but unavailable when Obsidian is closed and slower per call — fatal
  for per-prompt injection. Direct FS chosen instead.

- **Keep two-way DB↔vault sync (#770 extended to write-back).** Rejected: two
  writers means a real merge problem and re-creates the divergence the
  `obsidian_post_file` retirement warns against. Single-writer + derived index
  avoids it.

## Consequences

- **Positive:** one store the agent and UI both see; memory is local, private, and
  user-inspectable/editable as plain markdown in Obsidian; the index is disposable
  so corruption is recoverable by rebuild; prod is decoupled from private memory;
  the topology now matches agent sessions (`:4001`).
- **Negative / risks:** memory no longer roams across devices automatically (by
  design); a one-time migration must run per user before prod is abandoned, or
  pre-migration prod memories are stranded; file-watch on macOS needs care
  (debounce, ignore the index's own writes) to avoid rebuild storms; the dormant
  prod routes are tech debt until a cleanup PR removes them.
- **Don't-break-prod:** `postgres_bootstrap.ts` `agent_memory` DDL stays; prod
  `/agent-memory` routes keep responding (now dormant) so a stale client cannot
  500. SQLite migrations are additive only.
