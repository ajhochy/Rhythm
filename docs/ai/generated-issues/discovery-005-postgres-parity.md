# Discovery-005: Fix Postgres inertness so discovery/gaps run in production

## Goal

Make the capability-gap → external-discovery pipeline function on Postgres (production), not just local SQLite. Today the whole "found" path is silently inert in prod: the optimizer seeder early-returns under Postgres, and the capability-gaps repository falls back to a throwaway in-memory DB. This is the gating blocker for "found-first" being real on the shipping product.

## Context

Per project memory (`project_postgres_sqlite_schema_drift`): tests + local dev are SQLite; **prod is Postgres**. Two hard stops make discovery a no-op there:
- `seedOrgOptimizerTask` returns early under Postgres (`org_optimizer_seed.ts:249-251`) → the discovery/optimizer scheduled tasks are never seeded in prod.
- `AgentCapabilityGapsRepository` falls back to a throwaway in-memory DB when not on SQLite (`agent_capability_gaps_repository.ts:99-105`) → gaps written in prod evaporate, and the audit (`org_audit_service.ts:478` `listOpenAsync`) sees zero, so discovery early-returns.

Net: on prod, harvest never records durable gaps and discovery never runs. Fixing this requires a real Postgres-backed gaps table and a Postgres-safe seed path.

## Likely files

- `apps/api_server/src/repositories/agent_capability_gaps_repository.ts` — in-memory fallback (`:99-105`), all query methods (need Postgres-parity implementations)
- `apps/api_server/src/services/org_optimizer_seed.ts` — Postgres early-return (`:249-251`)
- `apps/api_server/src/database/migrations.ts` — add `agent_capability_gaps` (and any optimizer/proposal tables it depends on) to the Postgres bootstrap
- `apps/api_server/src/database/postgres_bootstrap.ts` (per project memory — new columns/tables need an ALTER/backfill here or prod 500s)
- `apps/api_server/src/services/org_proposal_*` — verify proposal/measure tables also have Postgres parity (discovery output path)

## Acceptance Criteria

- [ ] **Postgres-backed gaps:** `agent_capability_gaps` exists in the Postgres schema (migration + bootstrap), and `AgentCapabilityGapsRepository` reads/writes it durably on Postgres — no in-memory fallback in prod. `insertIfAbsentAsync`, `listOpenAsync`, `resolveByDedupKeyAsync` all work against Postgres.
- [ ] **Seed runs on Postgres:** the optimizer/discovery scheduled tasks seed on Postgres (remove or correctly gate the `:249-251` early-return) so the crons from Discovery-003 actually exist in prod. If any part must stay SQLite-only, document precisely why and what the prod substitute is.
- [ ] **Proposal/measure parity:** the discovery output path (`agent_org_proposals` + measure) is confirmed to persist on Postgres so an adopted skill survives (spot-check the applier + measure tables for Postgres columns).
- [ ] **No SQLite regression:** local SQLite behavior is unchanged; the same code paths work on both engines (guard by engine detection, not by disabling one side).
- [ ] **Parity test:** a test (or documented manual check against a Postgres instance) proves a gap written on Postgres is read back by `listOpenAsync` and resolved by `resolveByDedupKeyAsync`. Note if CI is SQLite-only and this requires a manual/prod verification step.
- [ ] `tsc --noEmit && npx vitest run` passes in `apps/api_server`.

## Dependencies

- Blocks the prod-facing behavior of **Discovery-004** and **Discovery-006**. Land 005 before relying on gap-driven or MCP discovery in production.
- Coordinates with **Discovery-003** (the crons it re-enables only fire in prod once seeding works here).

## Out of Scope

- Changing gap-detection logic (Discovery-004) or MCP discovery (Discovery-006).
- Data migration of the 152 local SQLite gaps into prod (they are dev-local; do not copy dev data to prod).

## Data safety

- **Do not copy local/dev gap data into production.** Schema/parity only.
- New Postgres tables/columns must be added via the bootstrap ALTER path (per `project_postgres_sqlite_schema_drift`) or prod requests will 500.
- No customer/private data in gap rows.
