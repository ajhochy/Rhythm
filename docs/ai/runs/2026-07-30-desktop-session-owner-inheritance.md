---
date: 2026-07-30
repo: Rhythm
branch: codex/mobile-session-owner-inheritance
pr: null
issues: [1231]
status: verified
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# Desktop session owner inheritance and local backfill

## Files

- `apps/api_server/src/controllers/agent_sessions_controller.ts`
  - Gives tokenless local desktop creates the sole paired Mac owner.
- `apps/api_server/src/repositories/mobile_devices_repository.ts`
  - Resolves one distinct paired user from durable device history and fails
    closed for missing or ambiguous history.
- `apps/api_server/src/contract/issue_1231_session_catalog_sync.test.ts`
  - Covers fresh/unpaired, active plus revoked same-user, and conflicting-user
    histories.
- `apps/api_server/src/__tests__/issue_1231_session_catalog_live.test.ts`
  - Reproduces the shipping tokenless desktop request through the real API and
    engine.
- `docs/ai/decisions/2026-07-30-desktop-session-owner-inheritance.md`
  - Records the local ownership rule and rejected alternatives.

## Checks

- Pre-fix isolated live regression:

  ```bash
  RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 \
  RHYTHM_LIVE_URL=http://127.0.0.1:4198 \
  RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:4197 \
  RHYTHM_LIVE_DB_PATH=/private/tmp/rhythm-owner-contract-sandbox/rhythm.db \
  RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-owner-contract-sandbox \
  RHYTHM_LIVE_HUMAN_CAPABILITY=<throwaway-sandbox-capability> \
  npx vitest run src/__tests__/issue_1231_session_catalog_live.test.ts \
    --no-file-parallelism
  ```

  Failed as expected: the paired gateway list was empty and did not contain
  the desktop-created SDK session.

- `npm run build` in `apps/api_server` — passed.
- `npx vitest run
  src/contract/issue_1231_session_catalog_sync.test.ts
  --no-file-parallelism` — passed: 6 tests.
- Post-fix isolated live command above — passed: 1 file, 1 test, 7.36 seconds.
  It rebuilt the vendored engine and API through `tools/dev/sandbox.sh`, then
  verified desktop-to-mobile, mobile-to-desktop, and lifecycle convergence.
- `ai-workflow checks --level issue` — passed: Flutter analyze/format, API
  TypeScript, and MCP TypeScript. The first sandboxed attempt failed only
  because Flutter could not update its SDK cache and the disposable checkout
  lacked MCP dependencies; the identical escalated rerun passed.
- `ai-workflow checks --level pr` — passed after installing the disposable
  checkout's omitted mobile dependencies: Flutter analyze/format/tests, API
  lint/tests/build, MCP tests/build, fork typecheck/session tests, and every
  configured mobile static/contract/fake-server/web-E2E leg. The first attempt
  reached the same green source checks but reported missing local `eslint` and
  Playwright binaries.
- Final isolated runtime probes:

  ```bash
  curl -fsS http://127.0.0.1:4198/health
  curl -fsS http://127.0.0.1:4198/opencode/health
  ```

  Returned `status: ok` for the API and `status: ready` for the rebuilt engine.
  The final env-gated live test then passed in 2.32 seconds.
- GitNexus `detect-changes` for both `scope=all` and
  `scope=compare, base_ref=main` — medium risk, five indexed files/eight
  symbols, and one affected `Create → AppError` flow. This matches the intended
  session-create boundary.
- `git diff --check` — passed.
- Post-commit verification rerun at `5969a2469`:
  - `ai-workflow checks --level issue` passed after rerunning outside the
    filesystem sandbox so Flutter could update its SDK cache.
  - The first `ai-workflow checks --level pr` rerun had one unrelated,
    non-reproducible 404 in the built-in `.tif` case of
    `agent_designs.test.ts`; all other gates passed.
  - The exact serial API command then passed 441 files / 3,695 tests, and the
    isolated agent-designs file passed 31/31. Follow-up:
    [flaky-agent-designs-finished-artifact-404.md](../generated-issues/flaky-agent-designs-finished-artifact-404.md).

## Notes

- Before the live backfill, a consistent SQLite backup was created at
  `~/Library/Application Support/Rhythm/backups/rhythm-before-session-owner-backfill-20260730T162748Z.db`;
  its integrity check passed.
- The local SQLite backfill assigned user `1` to 3,005 existing unowned
  sessions, inferred 235 project IDs by longest active-project `cwd` prefix,
  and added 164 missing eligible mobile session claims. A background session
  created afterward by the still-installed old app was also assigned user `1`.
- Final live database checks: zero unowned sessions, zero eligible missing
  claims, and `PRAGMA integrity_check = ok`.
- 532 legacy non-system SDK sessions have directories outside registered
  projects and remain intentionally absent from the project-scoped mobile
  catalog.
- Eight orphan `agent_session_messages` rows were present in the pre-backfill
  backup and remain a separate pre-existing integrity issue; this change did
  not create them.
