---
date: 2026-10-08
repo: Rhythm
branch: fix/scheduled-dayflow-memory-router-20261008
pr: null
issues: [router-D2]
status: NEEDS_CONTEXT
tags: [run, Rhythm]
---

## Files

- Production: apps/api_server/src/services/decision/model_router.ts only. Preserve prior uncommitted Slice D changes.
- Tests: model_router.test.ts, turn_routing.test.ts, mobile_routing_scope.test.ts; necessary existing router consumers model_catalog_routing.test.ts and sol-choice-boundary.test.ts now drain shadow work before inspecting audit rows/teardown.
- This required run note is the exception to the user's no-docs request, per specialist developer instructions. No shared project-state/plan updates.

## Checks

Phase 0: acceptance-contract invoked first. RED before production edits:

Working directory: apps/api_server.
`npx vitest run src/services/decision/model_router.test.ts src/services/decision/turn_routing.test.ts -t 'D2' --no-file-parallelism`

```
Test Files  2 failed (2)
     Tests  6 failed | 1 passed | 51 skipped (58)
```

Deferred classifier, concurrent same-session, deferred catalog, and composed session turn received `blocked` rather than the baseline result. Throwing classifier returned reason `error` instead of immediate `shadow`. Catalog throw test observed classifier-derived confidence in the old awaited result. Initial narrower RED run had 4 failures (one missing-hook error); corrected RED above demonstrates six assertion failures, not missing-hook errors.

Phase 1: inspect prior router diff first; read AGENTS.md, project-state.md, current-plan.md; inspect complete intended production surface and existing test consumers. CLI before production edit:

`gitnexus impact routeTurnTier --direction upstream --repo /Users/ajhochhalter/Documents/Rhythm-pr-worktrees/scheduled-dayflow-memory-router-20261008`

Result: exact, LOW, impactedCount 0, direct 0, processes_affected 0, modules_affected 0. Source review nevertheless confirms routeTurnForSession -> routeTurnTier, shared by desktop/mobile; composed and mobile tests retained. No API handler edits.

Phase 2: detach the existing classification/catalog/logging pipeline for shadow; module-level session and promise sets; catch failures with fixed body-free logger.warn messages; finally removes both pending promise and session guard. On mode still uses the same awaited pipeline. Test hook is test-only by caller convention, with no production caller.

Validation attempt 1:
`npx vitest run src/services/decision src/__tests__/mobile_routing_scope.test.ts --no-file-parallelism`
Result: 2 failed / 18 passed files; 11 failed / 276 passed tests. Only obsolete synchronous shadow assertions in model_catalog_routing.test.ts and sol-choice-boundary.test.ts failed. Repaired those router tests with the drain hook, preserving persisted probability/latency/selection assertions.
`npx tsc --noEmit`: one new generic ChoiceClient fixture diagnostic in model_router.test.ts; repaired with the existing injected-client casting pattern. No unrelated configured diagnostics repaired.

Validation attempt 2, exact requested command (run via working-directory option, equivalent to cd apps/api_server):
`cd apps/api_server && npx vitest run src/services/decision src/__tests__/mobile_routing_scope.test.ts --no-file-parallelism`

```
Test Files  20 passed (20)
     Tests  289 passed (289)
  Start at  12:25:16
  Duration  24.03s (transform 1.53s, setup 98ms, import 3.50s, tests 18.77s, environment 1ms)
```

`npx tsc --noEmit`: exit 0, no diagnostics. `git diff --check`: exit 0.

## Acceptance / handoff

- E1: detached classifier and catalog tests return `{ tier: null, applied: false, mode: 'shadow', reason: 'shadow' }` while boundaries remain blocked; audit work finishes only after release. On mode remains awaited. Important literal-spec qualification: old shadow success included classifier-derived optional confidence and failures could return classifier status as reason. These cannot be known without waiting. Immediate results omit confidence and use shadow; audit rows preserve confidence/status/failure cause. This was disclosed during implementation and requires verification of the intended interpretation of "same shape/values".
- E2: `D2 E2: concurrent shadow calls dedupe in-flight even for every_prompt` proves one call/one row; after drain a new every_prompt call yields a second row. Failed background work also releases the guard. Sessionless calls remain independent.
- E3: `D2 E2/E3: sessionless shadow calls are independent and the hook waits for both` releases work separately and proves the drain stays pending until both finish; teardown drains before restoring env/closing DB.
- E4a: `D2 E1/E3: shadow returns before a deferred classifier and drains one detailed decision` asserts exactly one real SQLite decision row, confidence/model/latency/baseline, scores/margin and wouldApply/catalog/pickedModel/catalogLatencyMs.
- E4b: concurrent shadow test above.
- E4c: `D2 E4c: thrown background classifier warns without exposing the body or rejecting the caller`; `D2 E4c: real catalog throw is warned body-free and recorded without affecting the caller`; `D2 E4c: shadow failure cause is persisted only after the background work drains`. No unhandled rejection observed by Vitest.
- E4d: `D2 E4d: on still waits for the classifier before applying a route`, plus existing on/scope/catalog/mobile tests green.
- E4e: `never reroutes pinned sources in shadow/on`, existing D6 and R5 pin tests green.
- E5: exact requested suite passed as above; final tsc has no new diagnostics (nor existing ones at this shared worktree snapshot).

Approved scope: user D2 router scheduling + necessary router unit test adjustments, no material production scope expansion. Two additional existing router test files were adapted only because the requested issue-level suite exposed synchronous assumptions. Preserve all other specialists' uncommitted work. No memory/dayflow/agent_runner edits by this specialist. No commit, push, install, servers, sandbox or network/port probes. Live verification deliberately NOT RUN under user's runtime prohibition. Implementation and unit validation are complete, but final status is NEEDS_CONTEXT solely for E1's internally conflicting literal requirement: confirm that immediate shadow results may omit classifier-derived confidence and return shadow instead of a future classifier error status. No green literal E1 claim is made.

Owned-file cumulative git diff stat (includes prior Slice D; do not attribute all lines to D2): 6 files, 450 insertions(+), 34 deletions(-). Orchestrator owns further live verification and final delivery.
