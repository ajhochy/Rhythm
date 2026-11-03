---
date: 2026-10-20
repo: Rhythm
branch: test/feature-playwright-2026-10-19
pr: null
issues: []
status: unverified
tags: [run, rhythm]
---

# Completed Once timing warning repair

## Files

- `apps/web/src/scheduleTiming.mjs` and `.d.mts`: recognize a consumed Once only when both timestamps parse, the last run is at or after its due instant, and terminal status is `success` or `completed_no_op`.
- `apps/web/src/components/ToolWorkspace.tsx`: omit the missing-next-run warning for that consumed Once. Enabled recurring rows, never-run/invalid Once rows, and future-rescheduled rows retain the warning; disabled rows still have none.
- `apps/web/tests/schedule-timing.test.mjs` and `post-m1-phase-7-schedules-quality.redspec.ts`: focused helper boundaries and rendered Tasks inspector cases using canonical schedule fields.
- The checked private natural Once case remains unchanged by the product repair; its pre-fix native RED is recorded in the [focused result](../../testing/results/2026-10-20-synthetic-completed-once-warning-recon.md).

## Checks

- Exact signed 5dff checked native RED: **1 unexpected failure**, 0 skips/flaky, 165.304 seconds, CLI exit1 only at expected warning absent/actual present. Real run, SDK/UI linkage, zero tools, owned cleanup, bundle hashes and loan scrub succeeded. Native GREEN requires a new exact signed build and is **pending**.
- Before product edit, guarded rendered RED expected zero warning for a valid completed Once but received one.
- After product edit, `npm run build:guard -- node --test apps/web/tests/schedule-timing.test.mjs`: **6/6 pass**.
- `npm run build:guard -- ./node_modules/.bin/tsc -p apps/web/tsconfig.app.json --noEmit`: exit0.
- Guarded rendered `post-m1-phase-7-schedules-quality.redspec.ts`: **8/8 pass**. An intermediate fixture used nonexistent scheduler terminal `completed`; it was corrected to canonical `success` before the final run. No product behavior was broadened for that fixture mistake.
- `git diff --check`: exit0. GitNexus `detect-changes --scope unstaged` reported low risk and zero affected indexed processes, but its stale index misattributed the changed schedule JSX to `LiveWebhooksUnavailable`; manual scope review identifies only the live schedule inspector and new helper/tests. This check preceded any commit.

## Notes

The earlier schedule warning was added for enabled rows without `nextRunAt`; it did not distinguish a legitimately consumed one-time job. The new predicate checks the persisted row and leaves all other missing-next-run warnings intact. GitNexus upstream `LiveSchedulesTool` was LOW with zero indexed callers/processes, but its index trails this worktree by 320 commits; manual blast is the live Tasks schedule inspector. The new helper had UNKNOWN indexed impact. No API, scheduler, engine, model routing, or backend permission path changed. Native rebuild and checked GREEN remain outstanding.
