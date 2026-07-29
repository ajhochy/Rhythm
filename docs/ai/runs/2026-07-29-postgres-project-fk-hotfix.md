---
date: 2026-07-29
repo: Rhythm
branch: codex/hotfix-postgres-project-fk
pr: null
issues: []
status: verified
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# Postgres project-reference bootstrap hotfix

## Files

- `apps/api_server/src/database/postgres_bootstrap.ts`
  - Keeps `agent_sessions.project_id` as nullable `TEXT` without referencing the
    intentionally SQLite-only `projects` table.
- `apps/api_server/src/__tests__/mobile_gateway_postgres_schema.test.ts`
  - Adds a normal-CI schema contract for the logical-reference boundary.
- `apps/api_server/src/__tests__/postgres_bootstrap_live.test.ts`
  - Adds an env-gated real-Postgres bootstrap and idempotency contract.
- `docs/ai/decisions/2026-07-29-postgres-project-id-logical-reference.md`
  - Records the cross-engine schema decision.
- `docs/ai/generated-issues/postgres-all-role-stream-bridge-reconciliation.md`
  - Tracks a separate pre-existing Postgres/default-role runtime error found by
    the smoke gate.

## Checks

- Failure reproduction (before the source fix):

  ```bash
  RHYTHM_LIVE_POSTGRES_BOOTSTRAP=1 \
  RHYTHM_LIVE_POSTGRES_URL=postgres://postgres:<test-password>@127.0.0.1:55432/rhythm_test \
  npx vitest run src/__tests__/postgres_bootstrap_live.test.ts
  ```

  Failed as expected with PostgreSQL `42P01`: `relation "projects" does not
  exist`, originating at `runPostgresBootstrap`'s `agent_sessions` ALTER batch.

- Targeted normal-CI contract:

  ```bash
  npx vitest run \
    src/__tests__/mobile_gateway_postgres_schema.test.ts \
    src/__tests__/postgres_bootstrap_live.test.ts
  ```

  Result: 2 passed, 1 env-gated live test skipped.

- Real PostgreSQL 16 contract after the fix:

  ```bash
  RHYTHM_LIVE_POSTGRES_BOOTSTRAP=1 \
  RHYTHM_LIVE_POSTGRES_URL=postgres://postgres:<test-password>@127.0.0.1:55432/rhythm_test \
  npx vitest run src/__tests__/postgres_bootstrap_live.test.ts
  ```

  Result: 1 passed. The test runs bootstrap twice, asserts no `projects`
  relation exists, asserts `project_id` is nullable and has no FK, and stores a
  logical project ID successfully.

- Issue-level gate:

  ```bash
  ai-workflow checks --level issue
  ```

  Result: Flutter analyze/format, API TypeScript, and MCP TypeScript all pass.

- Full PR gate:

  ```bash
  ai-workflow checks --level pr
  ```

  Result: every configured Flutter, API, MCP, fork, and mobile
  test/typecheck/build/e2e leg passes.

- Isolated built-runtime smoke:

  ```bash
  DB_CLIENT=postgres RHYTHM_ROLE=all \
  RHYTHM_SANDBOX_API_PORT=4298 \
  RHYTHM_SANDBOX_ENGINE_PORT=4297 \
  RHYTHM_MOBILE_GATEWAY_PORT=4289 \
  tools/dev/sandbox.sh up --foreground
  ```

  Fresh fork and API builds succeeded. `GET /health` returned `status: ok`;
  `GET /opencode/health` returned `status: ready`; the engine listener was the
  fork binary built from this worktree.

- GitNexus:
  - `impact(runPostgresBootstrap, upstream)` → LOW risk, one direct caller
    (`initDb`), zero affected indexed processes.
  - `detect_changes(scope=compare, base_ref=origin/main)` → low risk, zero
    affected indexed processes.

## Notes

- No production/Synology state was changed.
- The disposable local Postgres container used only generated test data.
- Smoke also exposed a pre-existing, non-fatal
  `OpencodeStreamBridge.reconcileSessionStatuses` call into the SQLite-only
  repository under `DB_CLIENT=postgres` + default `RHYTHM_ROLE=all`. The API
  and engine health probes were still green. The separate follow-up captures
  the required deployment-role/repository decision; it is not caused by this
  hotfix.
- Production should remain pinned to `ghcr.io/ajhochy/rhythm-api:sha-80d1552`
  until a human reviews/merges this PR and a corrected image is published.
