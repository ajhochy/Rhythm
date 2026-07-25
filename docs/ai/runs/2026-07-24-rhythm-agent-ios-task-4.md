---
date: 2026-07-24
repo: Rhythm
branch: feat/rhythm-agent-ios-roadmap
pr: null
issues: []
status: done_with_concerns
tags: [run, Rhythm]
---

# Rhythm Agent iOS roadmap — Task 4

## Files

- Added verifier-only mobile pairing/device repository and dedicated additive SQLite schema initializer.
- Added pairing service, controller, five HTTP endpoints, and agent-execution-gated app composition.
- Added additive Postgres table definitions without changing the shared SQLite migration hub.
- Added focused service, route, Postgres schema-parity, and gated live HTTP tests.

## Checks

- Focused RED/GREEN cycles covered additive/idempotent schema creation, 32-byte code/token hashing, one-time use, expiry (including the exact boundary), Rhythm-user mismatch, one-active-host replacement, revocation, and all five HTTP endpoints.
- Final focused/regression suite:

  ```text
  npx vitest run src/services/__tests__/mobile_pairing_service.test.ts src/__tests__/mobile_gateway_routes.test.ts src/__tests__/mobile_gateway_postgres_schema.test.ts src/__tests__/mobile_gateway_live.test.ts src/__tests__/issue_755_role_separation.test.ts src/__tests__/agent_configs_routes.test.ts
  Test Files 5 passed | 1 skipped (6)
  Tests 74 passed | 1 skipped (75)
  ```

- API build:

  ```text
  npm run build
  exit 0 (TypeScript build and postbuild completed)
  ```

- Gated live test attempt:

  ```text
  tools/dev/sandbox.sh up
  tools/dev/sandbox.sh: line 48: bun: command not found

  tools/dev/sandbox.sh down
  Sandbox removed: .../rhythm-dev-sandbox
  ```

  The checked-in `mobile_gateway_live.test.ts` is gated by `RHYTHM_LIVE_E2E=1` and drives the real HTTP API surface, but execution was blocked because the mandatory sandbox could not build the bundled engine without `bun`. No alternate server launch was used after the sandbox-only safety rule was established. Final `sandbox.sh status` showed no API 4098 or engine 4097 listeners.

## Notes

- GitNexus pre-edit impact: `createApp` LOW/0 upstream; `runPostgresBootstrap` LOW/one direct caller (`initDb`); `initDb` LOW/0 upstream; `runMigrations` HIGH/18 direct callers and 32 impacted symbols. `runMigrations` was not edited.
- SQLite schema initialization is owned by the new mobile gateway composition path and uses only `CREATE TABLE IF NOT EXISTS`.
- Postgres definitions are additive `CREATE TABLE IF NOT EXISTS` statements for schema parity; pairing remains local-only.
- Secrets use `crypto.randomBytes(32)`, only SHA-256 verifiers are persisted, comparisons use `timingSafeEqual`, and mobile gateway errors never forward unknown errors containing request bodies.
- Bundled-engine live execution remains for Task 18 or an environment with `bun` available.
