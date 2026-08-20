---
date: 2026-08-20
repo: Rhythm
branch: agent-stack/si-causal-runtime-v2-codex
pr: null
issues: [C6]
status: ready-for-verification
tags: [run, Rhythm]
---

## Contract

- `docs/ai/contracts/issue-c6-production-calibration.json`
- RED: focused contract run failed behaviorally before implementation: decision/regression observations were absent, snapshot counted 6 instead of 5, summary calibration fields were absent, and proposed ordering remained created-at descending.
- GREEN: final focused run passed 163/163. This is the requested falsification-and-restoration cycle.

## Files changed

- Added production observation derivation/recording service.
- Wired experiment decisions/retries and post-deploy regressions.
- Limited snapshots to decision observations, added owner-scoped summary fields, and ranked only the proposed queue.
- Added focused decision, retry, fail-closed, regression, owner-isolation, counting, ranking, and authority-boundary assertions.
- Added this mandatory workflow contract/run record; no product documentation was changed.

## Checks run

- `npx vitest run src/services/__tests__/org_proposal_experiment_service.test.ts src/services/__tests__/org_proposal_measure.test.ts src/__tests__/c6_calibration_observation.test.ts src/__tests__/c6_calibration_snapshot.test.ts src/__tests__/c6r_2_calibration_owner_scope.test.ts src/__tests__/c6_api_summary.test.ts src/__tests__/org_proposals_routes.test.ts src/__tests__/c6_calibration_boundaries.test.ts` — PASS, 8 files / 163 tests.
- `node_modules/.bin/tsc --noEmit` — PASS.
- `npm run build` — PASS.
- `git diff --check` — PASS.
- GitNexus pre-edit symbol lookup — index did not contain the worktree's new C6 symbols; risk returned UNKNOWN, with no HIGH/CRITICAL finding.
- GitNexus `detect_changes(scope=all)` — LOW, no affected process found; output also included the pre-existing backed-up dirty C6 worktree state.
- One parallel validation attempt timed out in the route test setup while build and typecheck competed for resources; the same full focused command passed when rerun alone.

## Notes

- Observation input fails closed unless durable proposal confidence/version and a valid v2 evidence family are present and agree; only `system-prompt-v1` treatment is recorded.
- Calibration is consumed only by read-only summary/ranking code. Existing approval/gate route tests ran with calibration enabled and remained green; static boundary assertions exclude auto-apply, risk, promotion, CAS, and auth consumers.
- No UI, sandbox, Vitest configuration, full suite, live test, commit, push, or PR action was performed.
- The worktree contained substantial pre-existing C6 changes documented by the supplied backup snapshot; only the assigned production paths and focused tests were intentionally edited in this run.
