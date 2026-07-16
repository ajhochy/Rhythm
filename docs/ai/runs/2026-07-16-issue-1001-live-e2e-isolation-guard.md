---
date: 2026-07-16
repo: Rhythm
branch: (orchestrator-owned)
pr: (pending)
issues: [1001]
status: implemented — awaiting verification-gate
tags: [run, rhythm]
---

## Issue #1001 — live-E2E test agents leaking into the real agent config

## Files changed
- `apps/api_server/src/__tests__/live_e2e_929.test.ts` — wired the existing
  `assertLiveE2EIsolation()` guard as the first statement of all three
  `beforeAll` blocks (#929/#959/#969 describes).
- `apps/api_server/src/__tests__/live_e2e_948_949.test.ts` — wired
  `assertLiveE2EIsolation()` as the first statement of its `beforeAll`.
- `apps/api_server/src/__tests__/live_e2e_guard.test.ts` — NEW fast unit test
  (4 cases) for the guard. Runs in the normal suite (no live flag, no server).

## Design notes
- The shared guard helper `_live_e2e_guard.ts` (`assertLiveE2EIsolation()`)
  ALREADY existed on `main` and is already wired into
  `live_e2e_manager_direct_routing.test.ts`. Ponytail: reused it as-is rather
  than writing a second helper. My change is only the wiring into the two
  files named by the issue + the missing unit test.
- Guard logic (fail-closed): throws unless BOTH
  1. `RHYTHM_LIVE_E2E_ISOLATED=1` is set (operator's explicit acknowledgement
     that DB_PATH + RHYTHM_MANAGED_SKILLS_DIR + agents-dir backup/restore point
     at a throwaway backend), AND
  2. `DB_PATH` is set AND does not `resolve()`-equal the real Rhythm DB
     (`~/Library/Application Support/Rhythm/rhythm.db`).
  - "real/default" detection: unset `DB_PATH` is refused (that is exactly the
    case where the app falls back to a default — `env.ts` resolves
    `process.env.DB_PATH ?? <cwd>/rhythm.db`), and an explicit real-DB path is
    refused via `resolve()` path equality. The `RHYTHM_LIVE_E2E_ISOLATED=1`
    gate is the durable belt-and-suspenders prevention.
- Cleanup mechanism: both files already track every created id
  (`createdAgentIds` / `createdSessionIds` / `createdDraftNames`, pushed at
  creation time) and delete them in `afterEach`, which vitest runs after each
  test regardless of pass/fail (and after an interrupted/failed test). #929's
  mid-test draft name is pushed inside the `try` before its `finally`. This
  already satisfies the "clean regardless of outcome / even if interrupted"
  requirement, so no cleanup code was added (no redundant `afterAll`).

## Checks run
- Skip-check (no live flag → both files skip, suite green):
  `cd apps/api_server && MEMORY_VAULT_SUBDIR=memory npx vitest run src/__tests__/live_e2e_929.test.ts src/__tests__/live_e2e_948_949.test.ts`
  → `Test Files 2 skipped (2) | Tests 5 skipped (5)`.
- Guard unit test:
  `cd apps/api_server && MEMORY_VAULT_SUBDIR=memory npx vitest run src/__tests__/live_e2e_guard.test.ts`
  → `Test Files 1 passed (1) | Tests 4 passed (4)`.
- Typecheck: `cd apps/api_server && npx tsc -p tsconfig.json --noEmit` → EXIT=0.
- `git diff --name-only` confirms only the two owned test files changed; new
  unit test is the only new source file. Did NOT touch
  `agentSchedulerService.ts`, `agent_profile_sync.ts`, or `config/env.ts`.

## Notes
- The one-time operational cleanup of the ~7 leaked profiles in the real DB is
  NOT part of this change (operational, per the issue).
- End-to-end isolation proof against the sandbox (`tools/dev/sandbox.sh` on
  :4098) was NOT run in this pass; the guard unit test is the required proof
  per the issue. A human/live pass may exercise the full suite against the
  sandbox with `RHYTHM_LIVE_E2E_ISOLATED=1`.
