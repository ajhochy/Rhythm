---
date: 2026-06-27
repo: Rhythm
tags: [decision, Rhythm]
index: "[[Rhythm]]"
---

# Postgres bootstrap must CREATE every table it ALTERs; defer agent role-separation

## Context

A prod outage (2026-06-27) traced to `postgres_bootstrap.ts` ALTERing
`agent_configs` / `agent_sessions` without ever CREATEing them — those CREATEs
lived only in the SQLite `migrations.ts`. The Postgres and SQLite schema paths
have drifted before (see memory: Postgres/SQLite schema drift); tests are
SQLite-only so the gap passes every green local suite and only surfaces at
Postgres boot.

Investigation also surfaced a deeper architectural smell: the single
`rhythm-api` image runs all agent machinery in every deployment with no gating
(routes, `AgentScheduler`, opencode init), and `env.ts` has no
deployment-role concept — only `DB_CLIENT` and `AGENT_LOCAL`.

## Decision

1. **Crash-fix now:** make the Postgres bootstrap internally consistent — every
   table it ALTERs, it must also CREATE (with seeds where the SQLite path seeds).
   Shipped on `fix/2026-06-27-postgres-agent-tables-bootstrap`.
2. **Defer role-separation:** do NOT gate agent DDL out of the Postgres path as a
   quick fix. Properly separating agent-execution from the production role is a
   multi-surface change and is tracked as its own follow-up, to be designed
   deliberately — not under outage pressure.

## Alternatives considered

- **Gate agent session/config DDL out of the Postgres path (original "B").**
  Rejected as the immediate fix: agent routes + scheduler still run on prod and
  would 500 / error against missing tables, and some agent tables are
  legitimately prod-owned. It is the wrong shape without a role flag.
- **Leave the manual live-SQL hotfix only.** Rejected: the code is still broken;
  the next image redeploy would crash identically.

## Consequences

- Fresh Postgres deploys bootstrap cleanly; the SQLite↔Postgres parity invariant
  is now explicit in the run/decision record.
- Unused agent tables remain present in prod (cosmetically wrong, harmless) until
  role-separation lands.
- **Guard for future changes:** any new table added to the SQLite migrations that
  the Postgres bootstrap ALTERs MUST also get a matching CREATE in
  `postgres_bootstrap.ts`. Consider a test asserting CREATE/ALTER parity between
  the two paths.
