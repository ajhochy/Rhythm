---
date: 2026-08-27
repo: Rhythm
branch: fix/optimizer-generator-lanes
pr: 1489
issues: [1480, 1481, 1483, 1484]
status: ready-for-verification
tags: [run, Rhythm]
---

# PR #1489 deterministic candidate and teardown repair

## Acceptance

- RED: `npx vitest run src/contract/pr_1489_harness_race_repair.test.ts` — 2 failed / 5 passed. The contract found the fixed `Unique deployment audit` fixture and settlement before engine-session deletion.
- GREEN: the same contract passed 7/7 after the test-only repair.

## Files

- `apps/api_server/src/__tests__/live_e2e_1480_1481_1483_1484.test.ts` — per-run external candidate, collision preconditions/failure diagnostics, and bounded aggregate teardown.
- `apps/api_server/src/contract/pr_1489_harness_race_repair.test.ts` — RED/GREEN source contract for candidate identity and cleanup ordering/timeouts.
- `docs/ai/contracts/pr-1489-final-harness-repair.json` — executable two-criterion acceptance contract.

## Diagnostic and timeout design

- Candidate name/body/dedup identity use one per-process UUID slug. Before the discovery run, the test applies the production `titleSimilarity` threshold (`0.5`) to every installed skill and asserts the exact proposal dedup key is unused.
- A missing candidate proposal reports only the optimizer `capped`, `proposalsCreated`, `erroredReason`, and `byKind` fields; up to five 800-character candidate/draft scorer request records; current-run proposals; the global exact-dedup row; and installed overlap matches.
- `afterAll` has a 45-second hook timeout. It concurrently stops newly owned engine sessions with 4.5-second operation and 5-second aggregate bounds, then independently restores Anthropic and closes the fixture under bounds.
- After producers stop, teardown permits one full settlement (10 seconds), deletes owned configs/rows and the exact candidate dedup row, then performs one short settlement (2.5 seconds) and strict broad-row/byte/file baseline assertions.
- Every cleanup stage records its error and continues. The DB closes in `finally`; accumulated failures are thrown as one `AggregateError` after all attempts.

## Checks

- Static harness + adversarial: `npx vitest run src/contract/pr_1489_harness_race_repair.test.ts src/contract/pr_1489_adversarial_review.test.ts --no-file-parallelism` — 2 files / 22 tests passed (final rerun).
- Focused: `npx vitest run src/contract/issue_1483.test.ts src/services/__tests__/org_proposal_appliers_wiring.test.ts src/services/generators/__tests__/external_discovery_generator.test.ts src/__tests__/agent_configs_routes.test.ts src/repositories/agent_configs_repository.test.ts --no-file-parallelism` — 5 files / 123 tests passed.
- Normal live invocation: `npx vitest run src/__tests__/live_e2e_1480_1481_1483_1484.test.ts --no-file-parallelism` — 1 file / 3 tests skipped as designed.
- Fail-closed live invocation: `RHYTHM_LIVE_E2E=1 npx vitest run src/__tests__/live_e2e_1480_1481_1483_1484.test.ts -t "pr-1489-c16-c20" --no-file-parallelism` — expected nonzero; isolation guard rejected missing `RHYTHM_LIVE_E2E_ISOLATED=1` and the real DB path before fixture/network setup.
- `node_modules/.bin/tsc --noEmit` — passed on final rerun.
- `npm run build` — passed, including postbuild.
- Contract JSON parse, `git diff --check`, and production-source diff — passed; production-source diff is empty.
- GitNexus impact and `detect_changes(scope=all)` were attempted against this worktree. The connected v41 reader cannot open the v42 index, so risk/change-flow results are unavailable; no HIGH/CRITICAL result was returned.

## Handoff

- PR #1486 owns the sandbox. This run did not start, stop, or use a sandbox and did not push.
- The final live rerun must keep Vitest on the operator HOME: do not set `HOME="$RHYTHM_SANDBOX_HOME"`. Pass `RHYTHM_SANDBOX_HOME`, `RHYTHM_MANAGED_SKILLS_DIR`, live URLs, DB path, sandbox directory, and fixture origins explicitly to the serial invocation.
- Product overlap/dedup logic is unchanged. The final rerun is ready for the PR #1486 sandbox owner.
