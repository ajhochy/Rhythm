---
date: 2026-08-27
repo: Rhythm
branch: fix/optimizer-generator-lanes
pr: 1489
issues: [1480, 1481, 1483, 1484]
status: ready-for-verification
tags: [run, Rhythm]
---

# PR #1489 exact scorer identity and active-top-level teardown repair

## Acceptance

- RED: `npx vitest run src/contract/pr_1489_harness_race_repair.test.ts --no-file-parallelism` — 3 failed / 8 passed. Exact generated-draft identity, parent-aware top-level cleanup, and producer-first status proof were absent.
- GREEN: same command — 11/11 passed after one stale-order contract repair rerun.
- Contract: `docs/ai/contracts/pr-1489-last-harness-repair.json` — 4/4 automated criteria pass.

## Files

- `apps/api_server/src/__tests__/_s4_harness_rows.ts` — exact purpose/body classifier returning `candidate`, `uniqueDraft`, or `otherScore`.
- `apps/api_server/src/__tests__/live_e2e_1480_1481_1483_1484.test.ts` — one source-traced deployment-gap fixture, exact rendered draft identity, separate scorer counts, and active-top-level recursive engine cleanup.
- `apps/api_server/src/contract/pr_1489_harness_race_repair.test.ts` — candidate/exact-draft/overlap/wrong-purpose contracts plus parent-aware cleanup ordering and bounds.
- `docs/ai/contracts/pr-1489-last-harness-repair.json` — maintained acceptance contract.

## Checks

- Static + adversarial: `npx vitest run src/contract/pr_1489_harness_race_repair.test.ts src/contract/pr_1489_adversarial_review.test.ts --no-file-parallelism` — 2 files / 26 tests passed.
- Focused: `npx vitest run src/contract/issue_1483.test.ts src/services/__tests__/org_proposal_appliers_wiring.test.ts src/services/generators/__tests__/external_discovery_generator.test.ts src/__tests__/agent_configs_routes.test.ts src/repositories/agent_configs_repository.test.ts --no-file-parallelism` — 5 files / 123 tests passed.
- Normal live invocation: `npx vitest run src/__tests__/live_e2e_1480_1481_1483_1484.test.ts --no-file-parallelism` — 1 file / 3 tests skipped.
- Fail-closed live invocation: `RHYTHM_LIVE_E2E=1 npx vitest run src/__tests__/live_e2e_1480_1481_1483_1484.test.ts -t "pr-1489-c16-c20" --no-file-parallelism` — expected nonzero; isolation guard rejected missing `RHYTHM_LIVE_E2E_ISOLATED=1` and the real DB path before fixture/network setup.
- `node_modules/.bin/tsc --noEmit` — passed.
- `npm run build` — passed, including postbuild.
- Contract JSON parse and `git diff --check` — passed.
- Production-source diff — empty; changed implementation files are confined to `src/__tests__`, `src/contract`, and `docs/ai`.
- GitNexus impact and `detect_changes(scope=all)` were attempted; the v41 reader cannot open the v42 index, so risk/change-flow results are `UNKNOWN` with no HIGH/CRITICAL result.

## Handoff

- Scorer observations: exactly 1 candidate and 1 unique draft are required; other scorer requests are separately counted and receive deterministic score 50. Candidate/draft scores remain 95/20 only for the exact UUID-purpose pairs.
- Cleanup enumerates parent IDs, closes fixture connections, restores/refreshes provider independently, status-checks once per cwd, aborts active top-level sessions at concurrency 4, proves every owned session idle, and deletes top-level sessions only. Post-idle delete failures are ID-logged diagnostics; abort/proof and final DB/file/provider failures remain fatal.
- Product/security behavior was not changed. No sandbox was started or used; PR #1486 owns the final sandbox rerun.
- The live gate is ready for its final serial rerun with the existing isolated environment command.
- No dependency, lockfile, product source, push, or merge change was made.
