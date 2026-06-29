---
date: 2026-06-28
repo: Rhythm
issues: [807, 801]
tags: [decision, Rhythm]
index: "[[Rhythm]]"
---

# Remove the prod (Postgres) agent_memory store — memory is local-vault-only

## Context

Memory epic #801 re-cast agent memory around the Obsidian Memory-Vault as the
single source of truth, with a disposable SQLite index served by the LOCAL agent
server on :4001 (#802 index service, #803 vault-first writes, #804 re-routed the
memory MCP tools off the prod Settings URL to :4001). After #804 no live writer
or reader targeted the production base anymore — the Flutter UI reads
`AppConstants.agentLocalBaseUrl` (:4001) and the MCP tools use `RHYTHM_AGENT_URL`.

The remaining prod remnant was the Postgres `agent_memory` table (+ FTS/owner
indexes) still created in `postgres_bootstrap.ts`, plus the `/agent-memory` route
mount. #807 removes the prod store. Maintainer decision: **start fresh — NO data
migration** (prod held nothing durable); nothing breaks until next deploy.

## Decision

1. Removed the Postgres `agent_memory` `CREATE TABLE` + `idx_agent_memory_fts` /
   `idx_agent_memory_owner` indexes from
   `apps/api_server/src/database/postgres_bootstrap.ts`, replacing them with a
   removal note. No other bootstrap object referenced the table (no FK / view),
   so prod boot stays clean.
2. Left the `/agent-memory` route mount in `app.ts` **inside the existing
   agent-execution gate** (`if (env.agentExecutionEnabled)`), documented as
   local-only. The store it serves is the SQLite index; with the Postgres table
   gone, prod no longer creates or exposes a memory store.
3. Updated the stale `migrations.ts` comment that claimed a non-disposable
   Postgres `agent_memory` exists — the SQLite index is now the only store.

## Alternatives considered

- **Read-prod → write-local export migration.** Rejected by the maintainer: prod
  has no memory worth keeping; start fresh.
- **Delete the Postgres branches in `agent_memory_repository.ts`.** Out of scope
  for the smallest correct change. Those branches only execute when
  `env.dbClient === 'postgres'`; prod (cloud role) never mounts the route and the
  local agent server is SQLite, so they are inert. Left for a follow-up if a
  Postgres agent role is ever truly retired.

## Consequences

- Prod (any role) never stands up an `agent_memory` table again. A deploy that
  somehow ran the agent role on Postgres would now 500 on `/agent-memory` use —
  acceptable and intended: memory must be local-vault/SQLite only.
- The local vault-backed store (routes/controller/repository over :4001) is
  unchanged and its tests stay green.
- #808 (guards) should assert: postgres_bootstrap creates no `agent_memory`
  table/index; no prod-base memory reads/writes; the local SQLite store + route
  remain intact.
