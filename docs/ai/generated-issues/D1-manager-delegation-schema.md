# D1 — Manager delegation schema

**Labels:** `api-server`, `agent-profiles`, `p4`
**Design authority:** `docs/ai/decisions/2026-06-24-manager-delegation.md`

## Goal

Add `agent_configs.allowed_delegates_json` as the fail-closed allowlist for manager profiles.

## Acceptance Criteria

- [ ] SQLite migration adds nullable `allowed_delegates_json TEXT` with a guarded `ALTER TABLE`.
- [ ] Postgres bootstrap adds `allowed_delegates_json TEXT` via `ADD COLUMN IF NOT EXISTS`.
- [ ] `AgentConfig` / `AgentConfigInput` / row mapping expose `allowedDelegatesJson`.
- [ ] Repository insert/update round-trips the value.
- [ ] Column tests prove fresh and migrated DBs contain the column.

## Likely Files

- `apps/api_server/src/database/migrations.ts`
- `apps/api_server/src/database/postgres_bootstrap.ts`
- `apps/api_server/src/repositories/agent_configs_repository.ts`
- `apps/api_server/src/__tests__/agent_configs_repository.test.ts`

## Required Tests

- Add or extend API server Vitest coverage for schema and repository round-trip.
