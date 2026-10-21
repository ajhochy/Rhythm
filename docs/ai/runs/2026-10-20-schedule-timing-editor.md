---
date: 2026-10-20
repo: Rhythm
branch: test/feature-playwright-2026-10-19
pr: null
issues: []
status: repairing
tags: [run, Rhythm]
---

# Schedule timing editor: Recon → Codify

## Files

- `apps/web/tests/packaged/packaged-ai-private-schedule-timing.spec.ts` — private packaged behavior contract, including the inspector Enable bypass case. It has **not** been run against a repaired build.

## Checks

- Native Recon on exact source `4fda3121184411ade608582428d10e9295fe7b2e`: one packaged observation passed. Receipt: `/private/tmp/rhythm-schedule-editor-recon-4fda/observation-5b838f70-a893-49d1-b9b2-6fc178695b7e.json`; log: `/private/tmp/rhythm-private-4fda-schedule-editor-recon-second-20261020.log`. The once, daily, and cron editor exposed only name, type, prompt, and enabled. Each UI POST sent `enabled:true` without a timing field; API and SQLite both stored `nextRunAt:null`. Every exact owned row was disabled and deleted; zero run and root rows were observed.
- Native codified RED on exact source `4fda3121184411ade608582428d10e9295fe7b2e`: `packaged-ai-private-schedule-timing.spec.ts` failed at the first `Run at (this Mac's local time)` visibility assertion because the control did not exist. Playwright JSON reports 1 unexpected failure, 0 passes, total 46.620 seconds; the assertion waited 10 seconds. Log: `/private/tmp/rhythm-private-4fda-schedule-timing-contract-red-20261020.log`; retained evidence: `/private/tmp/rhythm-schedule-timing-native-red-evidence-20261020/`. The synthetic fixture was retained by the failed CLI run. This is a real native RED for the missing editor timing control, **not** a full run of every later assertion.
- The inspector Enable bypass assertion was authored after that RED and is **UNRUN independently**. No native app, API, engine, model, build, or scheduler was launched for this test-authoring revision. A later exact-build Confirm must record its result separately.

## Contract for the UI repair

The editor needs timing controls and round-trip serialization for all five types: `Run at (this Mac's local time)` for once; `Time` and IANA `Timezone` for daily, weekly, and monthly; `Weekday` for weekly; `Day of month` for monthly; `Cron expression` and IANA `Timezone` for cron. The once input is a browser-local `datetime-local` value, converted to an ISO instant before POST/PATCH. The test uses UTC for recurring schedules and a future instant at least three hours away, without fake clocks or dispatching a task. It compares the actual UI request, API response/readback, SQLite timing columns, and the editor values after reload and edit. Scheduler code uses JS Sunday=0 for weekly `scheduledDay`; the migration comment says Monday=0 and should not drive this test.

An enabled definition with missing timing must stay in the editor with a visible timing error and send zero POST requests. An intentionally disabled blank once definition remains allowed and inert. On that disabled blank row, the inspector's Enable action must open the timing editor, explain the missing due time, and send zero PATCH requests; API and SQLite must remain disabled with `nextRunAt:null`, zero runs, and zero roots. The test cancels that editor and proceeds. After creating each enabled schedule, the test immediately disables its exact owned row by API, then verifies its persisted next due time and that no run or root session exists. It edits the disabled once and daily timing, reloads, and checks the saved values. `finally` discovers rows by the full nonce-bound name/prompt, disables any still enabled, checks owner/type/no history/no root, and deletes only those rows. A missing manifest is loudly `UNVERIFIED`.

If a server response for an enabled save still has `nextRunAt:null` (for example, malformed cron), the UI should retain the real created row in the list and keep an edit path visible while warning that no future run is scheduled. The implementation should avoid a silent success state or duplicate creation on retry. This branch needs a later targeted behavior check; the new packaged test covers valid timing and missing-input validation, not a forced malformed server response.

Existing private disabled-schedule Cancel/Delete tests already cover their own owner-bound API/SQLite outcome and are **KEEP**. The older fixture-only schedule history demo does not prove live scheduling and remains **REDO** outside this change. Actual scheduler execution is a separate pending Recon/Confirm boundary; persisted `nextRunAt` alone is not execution proof.
