---
date: 2026-08-27
repo: Rhythm
branch: fix/optimizer-generator-lanes
pr: 1489
issues: [1480, 1481, 1483, 1484]
status: ready-for-verification
tags: [run, Rhythm]
---

# PR #1489 absolute final test-harness repair

## Acceptance

- RED: `npx vitest run src/contract/pr_1489_harness_race_repair.test.ts --no-file-parallelism` — 3 failed / 10 passed. The maintained contract rejected the false one-draft cardinality, missing exact overlap body, synthetic-row engine cleanup, and missing continuous stability window.
- GREEN: same command — 13/13 passed.
- Contract: `docs/ai/contracts/pr-1489-last-harness-repair.json` — 4/4 automated criteria pass.

## Files

- `apps/api_server/src/__tests__/_s4_harness_rows.ts` — adds `stableMs` and resets `stableSince` on every broad-row digest change.
- `apps/api_server/src/__tests__/live_e2e_1480_1481_1483_1484.test.ts` — exact scorer-body set assertions and bounded, proof-gated real-engine cleanup.
- `apps/api_server/src/contract/pr_1489_harness_race_repair.test.ts` — executable continuous-stability, scorer, and cleanup contracts.
- `docs/ai/contracts/pr-1489-last-harness-repair.json` — removes the false exactly-one-draft criterion and records the final contract pass.

## Checks

- Contract RED then GREEN: 3 failed / 10 passed → 13/13 passed.
- Static + adversarial: `npx vitest run src/contract/pr_1489_harness_race_repair.test.ts src/contract/pr_1489_adversarial_review.test.ts --no-file-parallelism` — 2 files / 28 tests passed.
- Focused: `npx vitest run src/contract/issue_1483.test.ts src/services/__tests__/org_proposal_appliers_wiring.test.ts src/services/generators/__tests__/external_discovery_generator.test.ts src/__tests__/agent_configs_routes.test.ts src/repositories/agent_configs_repository.test.ts --no-file-parallelism` — 5 files / 123 tests passed.
- Issue/search final: `npx vitest run src/contract/issue_1483.test.ts src/services/generators/__tests__/external_discovery_search.test.ts src/services/generators/__tests__/external_discovery_generator.test.ts --no-file-parallelism` — 3 files / 40 tests passed.
- Normal live invocation: `npx vitest run src/__tests__/live_e2e_1480_1481_1483_1484.test.ts --no-file-parallelism` — 1 file / 3 tests skipped.
- Fail-closed live invocation: `RHYTHM_LIVE_E2E=1 npx vitest run src/__tests__/live_e2e_1480_1481_1483_1484.test.ts -t "pr-1489-c16-c20" --no-file-parallelism` — expected nonzero; isolation guard rejected missing `RHYTHM_LIVE_E2E_ISOLATED=1` and the real DB path before fixture/network setup.
- `node_modules/.bin/tsc --noEmit` — passed.
- `npm run build` — passed, including postbuild.
- Contract JSON parse and `git diff --check` — passed.
- Production-source diff — empty; all source edits are under `src/__tests__` or `src/contract`.
- GitNexus impact and `detect_changes(scope=all)` were attempted before edits/commit; the v41 reader cannot open the v42 index, so risk/change-flow results remain `UNKNOWN` with no HIGH/CRITICAL result.

## Notes

- Two candidates may legitimately score the same exact generated draft. The harness now requires at least one draft score request and exactly one distinct draft body instead of exactly one request.
- Synthetic seeded session rows remain DB cleanup inputs but are never sent to engine status, abort, or delete endpoints.
- Real engine status is attempted at most twice per distinct cwd with five-second request bounds. Busy/retry abort and idle-proof failures remain fatal; no engine delete occurs without idle proof.
- Status unavailability is diagnostic only after fixture/provider closure, zero residual rows, strict database/file/provider baselines, integrity checks, and two continuous seconds of broad-row stability all pass. Ephemeral sandbox engine history may remain in that narrow case.
- Product/security source is unchanged. Per instruction, no sandbox was started and no push was performed.

## Handoff

- READY_FOR_VERIFICATION after the single test-only commit and final serial live rerun by the verification owner.
