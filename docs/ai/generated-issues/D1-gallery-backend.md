# D1 — Gallery backend: `graphic-designer` role + `agent_designs` table + routes

**Labels:** `feature`, `api-server`, `security`, `phase-d`
**Depends on:** — (C1 is required for the launch flow in D2, not this issue)

## Context

The Gallery feature lets an agent produce Canva designs in a scoped session. This issue provides the backend: a `graphic-designer` MCP role file (scoping Canva tools), the `agent_designs` table in both databases, and the CRUD routes for design records. The Canva MCP server is already listed in `curated_mcp_servers.ts` (`{ id:'canva', type:'remote', url:'https://mcp.canva.com/mcp', requiredEnv:[] }`).

## Likely files

- NEW `.mcp-roles/graphic-designer.mcp.json`
- `apps/api_server/src/database/migrations.ts` (add SQLite `CREATE TABLE IF NOT EXISTS agent_designs`)
- `apps/api_server/src/database/postgres_bootstrap.ts` (add matching Postgres DDL)
- NEW `apps/api_server/src/repositories/agent_designs_repository.ts`
- NEW `apps/api_server/src/controllers/agentDesignsController.ts`
- NEW `apps/api_server/src/routes/agentDesignsRoutes.ts`
- `apps/api_server/src/app.ts` (register `app.use('/agent-designs', agentDesignsRoutes)`)

## Acceptance criteria

- [ ] `.mcp-roles/graphic-designer.mcp.json` mirrors the shape of `.mcp-roles/church-admin.mcp.json`: `mcpServers` lists `canva`; `allowedTools` for canva scopes to design-related tools (e.g., `generate-design`, `create-design-from-brand-template`, `export-design`, `get-design`, `get-design-content`, `get-design-pages`, `get-design-thumbnail`); `disabledMcpServers` includes `["bash", "computer", "editor", "filesystem"]`.
- [ ] `agent_designs` table schema: `id TEXT PRIMARY KEY`, `title TEXT`, `canva_url TEXT`, `thumbnail_url TEXT`, `session_id TEXT` (FK to `agent_sessions`), `created_at TEXT NOT NULL`.
- [ ] The table DDL appears in BOTH `migrations.ts` (SQLite) AND `postgres_bootstrap.ts` (Postgres) with identical columns.
- [ ] `GET /agent-designs` returns `[]` on an empty database and a JSON array of design records otherwise.
- [ ] `POST /agent-designs` creates a new design record and returns the created object.
- [ ] `GET /agent-designs/:id` returns a single record or 404.
- [ ] `DELETE /agent-designs/:id` returns 204.
- [ ] `tsc --noEmit` reports zero type errors.
- [ ] Routes are registered in `app.ts` under `/agent-designs`.

## Schema-drift gate (CRITICAL)

Both `migrations.ts` and `postgres_bootstrap.ts` MUST be updated. A vitest must assert `GET /agent-designs` returns `[]` (not 500) on a freshly initialized SQLite DB. Failure = prod 500s.

## Required validation commands

```bash
cd apps/api_server && node_modules/.bin/tsc --noEmit && npm test
```

New tests in `apps/api_server/src/__tests__/agent_designs.test.ts`: list empty, create, get by id, delete, 404 on unknown id.

## Security notes

- The `graphic-designer` role MUST include `disabledMcpServers: ["bash", "computer", "editor", "filesystem"]` — Gallery agent gets ONLY Canva-scoped tools.
- Result delivery (design records) is structured JSON. No freeform MCP target (SF-6).
- No per-request LLM endpoint override.

## Data-safety out-of-scope

No Flutter changes in this issue. No Gmail / email changes.
