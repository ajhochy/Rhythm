---
date: 2026-08-27
repo: Rhythm
branch: fix/optimizer-generator-lanes
pr: 1489
issues: [1489]
status: ready-for-verification
tags: [run, Rhythm]
---

# PR #1489 cleanup repair

## Files

- `apps/api_server/src/repositories/agent_configs_repository.ts` — delete the profile and projection ledger row in one SQLite transaction.
- `apps/api_server/src/repositories/agent_configs_repository.test.ts` — projection cleanup, rollback atomicity, and SQLite/Postgres ledger structure.
- `apps/api_server/src/__tests__/agent_configs_routes.test.ts` — create/project/delete contract preserving an unrelated profile and file cleanup call.
- `apps/api_server/src/__tests__/live_e2e_1480_1481_1483_1484.test.ts` — preserve whole-row rejection proof, clean the rejected profile before the positive control, and scope the positive digest to `agent_configs`, `agent_skills`, and `agent_profile_projections` plus managed files.
- `docs/ai/contracts/pr-1489-cleanup-repair.json` — executable acceptance contract and sandbox-owned live criteria.

## RED → GREEN

- RED: `npx vitest run src/__tests__/agent_configs_routes.test.ts -t "pr-1489-cleanup-c1"`
  - Failed because `projection-delete-target` remained in `agent_profile_projections` after HTTP deletion.
- GREEN: same command passed, 1 test passed.
- Final contract: `npx vitest run src/__tests__/agent_configs_routes.test.ts src/repositories/agent_configs_repository.test.ts && npx vitest run src/contract/pr_1489_adversarial_review.test.ts && npx vitest run src/__tests__/live_e2e_1480_1481_1483_1484.test.ts --no-file-parallelism`
  - 90 route/repository tests passed; 15 adversarial tests passed; 3 live tests skipped without `RHYTHM_LIVE_E2E=1`.

## Checks

- `npm run build` — passed (`tsc -p tsconfig.json` and postbuild).
- `npx tsc --noEmit` — passed.
- `! env RHYTHM_LIVE_E2E=1 npx vitest run src/__tests__/live_e2e_1480_1481_1483_1484.test.ts -t "pr-1489-c16-c20" --no-file-parallelism` — expected failure observed before fixture/network setup: isolation guard rejected missing `RHYTHM_LIVE_E2E_ISOLATED=1` and the real DB path.
- `git diff --check` — passed.
- GitNexus impact/API impact and `detect_changes(scope=all)` were attempted; all were unavailable because the index is v42 while the connected reader is v41. Risk remains UNKNOWN; exact search found one production caller of `AgentConfigsRepository.remove`, the DELETE controller.

## Backend parity

- The mutable profile repository and projection writer are explicitly local SQLite paths (`getDb`; Postgres projection recording no-ops).
- SQLite migrations and Postgres bootstrap both retain `agent_profile_projections(profile_id TEXT PRIMARY KEY, ...)`; the structural parity assertion passes.
- No schema change or Postgres runtime path was added.

## Commits

- `78415173` — `fix profile projection cleanup on delete`
- `7d36030a` — `test scope PR 1489 install cleanup digest`

## Handoff

- No sandbox was started; PR #1487 owns it.
- Invalid provenance still asserts exact whole `rowDigest`, exact profile row, managed files unchanged, and zero requests.
- Sandbox verification should run the existing PR #1489 live command; the repaired harness is ready for that run.
