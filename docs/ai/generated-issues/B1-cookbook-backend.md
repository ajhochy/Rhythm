# B1 — Cookbook backend: `agent_cookbook` table + CRUD routes

**Labels:** `feature`, `api-server`, `phase-b`
**Depends on:** —

## Context

The Cookbook is a reusable recipe/skill library for the agent scheduler. This issue creates the `agent_cookbook` table in both the SQLite (`migrations.ts`) and Postgres (`postgres_bootstrap.ts`) databases, then adds the repository, controller, and routes following the exact pattern of `agent_scheduled_tasks`. This is the backend prerequisite for the Flutter Cookbook feature (B2).

## Likely files

- `apps/api_server/src/database/migrations.ts` (add SQLite `CREATE TABLE IF NOT EXISTS agent_cookbook`)
- `apps/api_server/src/database/postgres_bootstrap.ts` (add matching Postgres `CREATE TABLE IF NOT EXISTS agent_cookbook`)
- NEW `apps/api_server/src/repositories/agent_cookbook_repository.ts`
- NEW `apps/api_server/src/controllers/agentCookbookController.ts`
- NEW `apps/api_server/src/routes/agentCookbookRoutes.ts`
- `apps/api_server/src/app.ts` (register `app.use('/agent-cookbook', agentCookbookRoutes)`)

## Acceptance criteria

- [ ] `agent_cookbook` table schema: `id TEXT PRIMARY KEY`, `title TEXT NOT NULL`, `description TEXT`, `steps_json TEXT NOT NULL` (serialized step array), `bound_config_id TEXT` (nullable FK to `agent_configs`), `created_at TEXT NOT NULL`, `updated_at TEXT NOT NULL`.
- [ ] The table DDL appears in BOTH `migrations.ts` (SQLite) and `postgres_bootstrap.ts` (Postgres) with identical columns and types.
- [ ] `GET /agent-cookbook` returns `[]` on an empty database and a JSON array of recipes otherwise.
- [ ] `POST /agent-cookbook` creates a new recipe and returns the created object with a generated `id`.
- [ ] `GET /agent-cookbook/:id` returns a single recipe or 404 if not found.
- [ ] `PATCH /agent-cookbook/:id` updates mutable fields (title, description, steps_json, bound_config_id) and updates `updated_at`.
- [ ] `DELETE /agent-cookbook/:id` deletes the recipe and returns 204.
- [ ] `tsc --noEmit` reports zero type errors.
- [ ] All routes are registered in `app.ts` under `/agent-cookbook`.

## Schema-drift gate (CRITICAL)

Both `migrations.ts` and `postgres_bootstrap.ts` MUST be updated. A vitest must assert that `GET /agent-cookbook` returns `[]` (not 500) against a freshly initialized SQLite DB. Failure to update both files = prod 500s (per repo memory "Postgres/SQLite schema drift").

## Required validation commands

```bash
cd apps/api_server && node_modules/.bin/tsc --noEmit && npm test
```

New tests go in `apps/api_server/src/__tests__/agent_cookbook.test.ts`, spin up `createApp().listen(0)` with `server.maxRequestsPerSocket = 1` (per testing-guide undici-flake guidance), cover: list empty, create, get by id, patch, delete, 404 on unknown id.

## Safety notes

- No shell/run_script action types; recipe `steps_json` is stored as opaque JSON — the scheduler enforces action-type enum at execution time.
- No per-request LLM endpoint override.
- `bound_config_id` is nullable and only stores a reference; no cascading delete required (orphaned references are acceptable).

## Data-safety out-of-scope

No Flutter changes in this issue. No MCP changes.
