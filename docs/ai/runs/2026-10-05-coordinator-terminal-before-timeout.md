---
date: 2026-10-05
repo: Rhythm
branch: fix/coordinator-terminal-before-timeout-r15
pr: null
status: source-qualified
tags: [run, rhythm]
---

# Completed coordinator receipts precede elapsed-time cancellation

The explicitly approved normal R14 one-shot arithmetic qualification admitted one scheduled OpenAI gpt-6.1-sol dispatch with a 30-second wall policy and 8,000-token soft total authorization. It completed 27.340 seconds after admission, with a 6.043-second assistant turn, 5,107 actual tokens, zero tool calls, and no overrun. The plan remained consumed through later minute ticks; no repeat occurred. Existing paused workstreams, jobs, profiles/grants, and legacy records retained their pre-test hashes.

A transport interruption delayed observation. R14 checked elapsed wall time before reading the exact completed receipt and incorrectly requested cancellation/marked usage unknown. Its existing exact-job engine reconciliation subsequently recorded the real usage without another inference or any budget/permission/criteria change. This was a recovered live qualification, not a clean automatic accounting pass.

## Files

- `persistent_workstream_coordinator.ts`: inspect the current known child's lifecycle before applying the elapsed wall deadline. Only a child confirmed still busy invokes the existing best-effort cancellation path. An idle/omitted-idle child proceeds through the unchanged strict terminal binding and usage checks.
- `persistent_workstream_coordinator.test.ts`: cover explicit-idle and omitted-idle completed workers first observed after the wall deadline. Keep overdue-busy cancellation and unknown/overshoot/control-drift protections.

No new scheduler, timer, model turn, permission, database schema, profile, reference, or budget behavior is introduced. This does not implement the separately requested persistent conversational coordinator or continuous coordination. The wall deadline remains checked by existing status/reconciliation reads and minute sweeps; it is not a hard per-call background timer.

## Checks

- `node node_modules/vitest/vitest.mjs run src/__tests__/persistent_workstream_coordinator.test.ts --no-file-parallelism --no-cache`: 50 tests passed, including both new late-observation regressions and existing cancellation, budget, and immutable receipt cases.
- `npm run build` in `apps/api_server`: passed.
- GitNexus upstream impact attempted for `reconcileJob`: target absent from the registered older index, risk UNKNOWN. Direct current-source callers: status, consumed-plan reconciliation, explicit unknown-job reconciliation.
- GitNexus detect-changes attempted in the isolated checkout: no matching registered index; exact scoped diff/pre/post hashes used before commit.

Normal successor build/runtime receipt is recorded outside this frozen source under the task-owned `coordinator-r15-terminal-ordering-20261005` directory. The one approved inference is not repeated for post-fix testing; a fresh clean model-driven automatic-accounting run remains unverified. Local qualification evidence is under `coordinator-r14-one-shot-20261005`, with exact consent/plan/workstream/job/dispatch bindings and native terminal metadata. No private history or reference bodies were injected.
