---
date: 2026-09-21
repo: Rhythm
branch: mega/2026-09-18-mobile-electron-hermes
pr: none (landed directly on the mega branch by request)
issues: []
status: green
tags: [run, rhythm]
---

# Scheduled runs no longer fire while the Mac is asleep

## Problem (established before this run, not re-derived)

Scheduled agent runs were dying with
`AgentRunner: Run timed out during prompt: no progress for 600000ms`.
Not a hung tool. The Mac is on battery with the lid shut; macOS wakes it for
~45-second **DarkWake** maintenance windows; the 1-minute scheduler tick fires
inside one of those windows and the machine re-sleeps ~15s later, freezing the
run mid-tool-call. The frozen call only resumes at the *next* DarkWake, by which
time the run-level inactivity timer has already killed it.

Evidence (engine DB `~/.local/share/opencode/opencode.db`, `mode=ro`):

- part `prt_0c3e81793001lsDMx6uZvVCdFx`, bash `agent-reach doctor --json`:
  start 2026-09-21 05:19:23 PDT, end 05:41:22 PDT, `(no output)`, exit null.
  `pmset -g log` shows DarkWake at 05:18:53 (45 secs) and again at 05:41:22 —
  started 30s into a 45s window, ended to the second on the next wake.
- Same signature 2026-09-18 with a different tool (`skill(theology-daily-scan)`):
  start 05:01:10 (DarkWake 05:00:23 +45s), end 05:20:10 = the next DarkWake.

~20 runs across six unrelated schedules share the error, several with identical
`ended_at` timestamps — one cause, most of the class.

## What already worked (verified by reading, not rebuilt)

Catch-up and coalescing were **already correct** and needed no change:

- `AgentScheduledTasksRepository.findDueAsync()` selects
  `next_run_at <= now` and returns **one row per task** however far overdue.
- `checkDueTasks` computes the next run with
  `computeNextRun({ after: new Date() })` — re-anchored to *now*, not to the
  missed slot.
- `startAgentSchedulerJob` runs an immediate boot pass for exactly this case.

So a laptop shut for a week already produced one catch-up run per schedule, not
seven. Only the wake gate was missing.

## What changed

`apps/api_server/src/services/agentSchedulerService.ts`

1. **Wake gate** — `isMachineAwake()` shells `pmset -g assertions` and reads the
   system-wide `UserIsActive` assertion, which macOS holds only while the display
   is on for user activity (0 during DarkWake and sleep). `checkDueTasks` returns
   early when tasks are due but the machine is not awake — **without touching
   `next_run_at`**, so the rows stay due and fire on the first tick after wake.
   Fail-open: probe error, timeout, or non-darwin host all return `true`.
   `AGENT_SCHEDULER_IGNORE_POWER_STATE=1` pins the gate open.
2. **Staleness** — `isMissedRunStale()`: a missed occurrence is stale once its
   **own next occurrence** has also passed. Derived from the schedule, so a daily
   goes stale after ~a day and a weekly after ~a week; no new user-facing setting.
   A `once` schedule is **never** stale — it is a specific thing the user asked
   for that never happened, so it always runs on wake rather than being dropped.
   A stale skip advances the schedule, stamps `last_run_status = 'skipped_stale'`
   with an explanatory `last_error`, and writes an
   `agent_scheduled_task_runs` row. No notification — a skip is expected
   behaviour, not a failure (Workstream A owns failure notification).

`vitest.setup.ts` pins `AGENT_SCHEDULER_IGNORE_POWER_STATE=1` so the rest of the
suite does not depend on whether the developer's display happens to be asleep.

## Files

- `apps/api_server/src/services/agentSchedulerService.ts`
- `apps/api_server/src/database/migrations.ts` (status-vocabulary comment only)
- `apps/api_server/vitest.setup.ts`
- `apps/api_server/src/__tests__/scheduler_wake_gate.test.ts` (new, 8 tests)

## Checks

- `npx tsc --noEmit` — clean.
- `npm test` (api_server) — **664 files / 6204 tests passed**, 0 failed,
  252 skipped.
- Mutation check: with the wake gate and the staleness branch each forced to
  `false`, exactly the two contract tests fail
  (`dispatches nothing … while the Mac is asleep`,
  `skips a missed run whose own next occurrence has also passed, visibly`) and
  the other six still pass. The tests fail when the behaviour is removed.
- Live probe of the real entry point (not a mock): `isMachineAwake()` against
  this machine's actual `pmset` returned `true` while awake, and returned
  `false` for a captured DarkWake-shaped `pmset` transcript.
- One pre-existing flake observed: `src/contract/pr_1489_harness_race_repair.test.ts`
  (`pr-1489-absolute-c2`, counts scheduler wait iterations) failed once under
  full-suite load, passed in isolation and on the clean re-run. Unrelated to this
  change — it touches neither file.

## Notes / follow-ups

- **Display sleep counts as "not awake."** `UserIsActive` drops when the display
  sleeps even with the lid open. A 6am schedule on an open-but-idle laptop is
  therefore held until the user touches it. That matches the stated intent
  ("only while the computer is open and awake") but is worth knowing.
- **The inactivity timer is still wall-clock.** `_withinRunDeadline` in
  `agent_runner.ts` measures with `Date.now()`, so a run interrupted by the lid
  closing *mid-flight* can still read as stalled. Not changed here: whether
  libuv's timers advance across macOS sleep was not established, and shipping
  clock arithmetic on an unverified model is worse than the gap. Follow-up.
- Per-schedule staleness tuning is deliberately not built; the derived rule needs
  no configuration.
