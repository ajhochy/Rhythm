# Postgres `all` role starts SQLite-only stream reconciliation

## Failure

A Postgres-backed API with the default `RHYTHM_ROLE=all` reaches healthy status
but logs an error when the OpenCode stream bridge reconciles session statuses.

## Repro Command

Launch `tools/dev/sandbox.sh up --foreground` with `DB_CLIENT=postgres`,
`RHYTHM_ROLE=all`, a disposable Postgres database, and isolated API/engine
ports. Probe `/health` and `/opencode/health`, then inspect the sandbox log.

## Expected

The Postgres-backed process should not invoke a repository path that requires
the intentionally absent SQLite connection.

## Actual

The API and engine become healthy, then log:

```text
[ERROR] [OpencodeStreamBridge] reconcileSessionStatuses: listActive failed:
Error: Database not initialized. Call initDb() first.
```

## Likely Cause

`RHYTHM_ROLE=all` starts `OpencodeStreamBridge`, whose
`reconcileSessionStatuses()` calls the SQLite-only
`AgentSessionsRepository.listActive()`. Under `DB_CLIENT=postgres`, `initDb()`
sets the SQLite singleton to `null`, so `getDb()` rejects the call.

## Likely Files

- `apps/api_server/src/services/opencode_stream_bridge.ts`
- `apps/api_server/src/repositories/agent_sessions_repository.ts`
- `apps/api_server/src/config/env.ts`
- Synology deployment environment/runbook

## Required Fix

Choose and enforce one supported contract:

1. Set the hosted deployment to `RHYTHM_ROLE=cloud` so local agent execution and
   stream reconciliation never start; or
2. Add a real Postgres repository implementation for every stream-bridge
   session operation before supporting `RHYTHM_ROLE=all` with Postgres.

Do not add a silent in-memory SQLite fallback in production.

## Required Tests / Evaluation

- Postgres-backed startup test for the selected deployment role.
- Assert no `Database not initialized` stream-bridge error is logged.
- Assert `/health` and every role-supported agent health endpoint.
- If `all` + Postgres remains supported, exercise status reconciliation against
  a real Postgres `agent_sessions` row.

## Priority

P1 follow-up. It is pre-existing and separate from the `projects` FK bootstrap
crash, but it is visible immediately after that crash is removed on a legacy
default-role deployment.
