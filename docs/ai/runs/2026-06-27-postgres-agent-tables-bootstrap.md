---
date: 2026-06-27
repo: Rhythm
branch: fix/2026-06-27-postgres-agent-tables-bootstrap
pr: TBD
issues: []
status: verified
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# Postgres bootstrap missing CREATE TABLE → prod outage + fix

## Summary

Production API (`api.vcrcapps.com`, `rhythm-api` container on the Synology NAS)
was returning **HTTP 502** — the `rhythm-api` container was crash-looping
(`Restarting (1)`). Postgres and the Cloudflare tunnel were healthy; only the
API was down.

Root cause: `apps/api_server/src/database/postgres_bootstrap.ts` ran
`ALTER TABLE agent_configs …` and `ALTER TABLE agent_sessions …` but never
`CREATE TABLE`d those two tables. Their CREATEs existed only in the **SQLite**
path (`migrations.ts`). `ADD COLUMN IF NOT EXISTS` does **not** guard a missing
*table*, so on the Postgres prod DB (which never had them) the bootstrap threw
`42P01 relation "agent_configs" does not exist` and aborted boot — classic
SQLite-tested / Postgres-prod schema drift.

## Resolution

1. **Live hotfix (manual SQL):** created `agent_configs` (+ index) and
   `agent_sessions` directly in the prod `rhythm` DB via
   `docker exec rhythm-postgres psql -U rhythm_user -d rhythm`. Restarted
   `rhythm-api`; it booted cleanly (`Rhythm API listening on port 4000`) and
   `/health` returned 200, `/tasks` 401 (auth-gated, alive).
2. **Permanent code fix (this branch):** ported the `CREATE TABLE` + index +
   4-preset seed for `agent_configs` and the `CREATE TABLE` for `agent_sessions`
   into the Postgres path, before the existing ALTER block, so a fresh deploy
   never 42P01s again. (The live hotfix alone did not fix the code — a fresh
   image redeploy would have crashed identically.)

Audit confirmed only `agent_configs` and `agent_sessions` were altered-but-never-
created in the Postgres bootstrap; all other tables are properly created.

## Files changed

- `apps/api_server/src/database/postgres_bootstrap.ts` — added the two missing
  CREATE TABLEs, the `idx_agent_configs_enabled` index, and the preset seed
  (`INSERT … ON CONFLICT (id) DO NOTHING`).

## Checks run

- `npm run build` (tsc) — PASS
- `npm test` (vitest) — PASS, 1273/1273
- Real-Postgres bootstrap test (disposable `postgres:latest` container): ran
  `runPostgresBootstrap` on a fresh DB → no 42P01; idempotent on re-run;
  `agent_configs` = 4 seeds (claude-code, codex, gemini-cli, opencode);
  `agent_sessions` created; ALTER columns applied. This reproduces and resolves
  the exact prod-crash scenario.

## Notes / follow-ups

- **Deferred architectural work (role separation):** investigation revealed the
  same image runs *all* agent machinery everywhere with no gating —
  agent routes mounted unconditionally (`app.ts`), `AgentScheduler` starts
  unconditionally (`server.ts:41`, confirmed ticking on prod), opencode SDK init
  runs unconditionally (fails harmlessly on prod with `spawn opencode ENOENT`).
  There is **no deployment-role concept** in `env.ts` (only `DB_CLIENT` and
  `AGENT_LOCAL`). Cleanly separating agent-*execution* from the production role
  is a multi-surface change (role flag gating routes + scheduler + opencode +
  DDL), not a DDL guard — and some agent tables (`agent_scheduled_tasks`,
  `pending_claude_triggers`) ARE legitimately used on prod. Filed as a follow-up
  rather than bolted on under outage pressure. See decision file.
- See `docs/ai/decisions/2026-06-27-postgres-bootstrap-create-parity.md`.
