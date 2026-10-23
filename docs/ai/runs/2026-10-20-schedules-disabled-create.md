---
date: 2026-10-20
repo: Rhythm
branch: test/feature-playwright-2026-10-19
pr: null
issues: []
status: repairing
tags: [run, Rhythm]
---

# Disabled schedule creation

## Files

- `apps/api_server/src/controllers/agentSchedulesController.ts`: accept and validate an optional boolean `enabled` on create; omitted or null keeps the existing enabled default.
- `apps/api_server/src/repositories/agent_scheduled_tasks_repository.ts`: persist explicit false in both SQLite and Postgres INSERTs; absent input still writes true.
- `apps/api_server/src/__tests__/agent_schedules_enabled_create_contract.test.ts`: real Express + SQLite create/read/list/due-task contract for disabled and default-enabled schedules, plus malformed-input rejection.

## Checks

- RED before product edit: `npm run build:guard -- /bin/zsh -f -c 'cd apps/api_server && npx vitest run src/__tests__/agent_schedules_enabled_create_contract.test.ts --fileParallelism=false'` failed 2/3. HTTP POST with `enabled:false` returned `enabled:true`; string `"false"` was accepted with 201. Full output: `/private/tmp/rhythm-schedule-enabled-create-red-20261020.log`.
- GREEN same focused command: 3/3 passed; `/private/tmp/rhythm-schedule-enabled-create-green-20261020.log`.
- Related guarded schedule cluster: five files, 31/31 passed; `/private/tmp/rhythm-schedule-enabled-related-green-20261020.log`.
- Guarded API `npx tsc -p tsconfig.json --noEmit` passed; `/private/tmp/rhythm-schedule-enabled-typecheck-20261020.log`.

## Notes

- Registry search found no prior entry for this create-path bug. `LiveSchedulesTool.save` sends `enabled:false` for an unchecked checkbox and the live gateway forwards it, but the controller discarded it; both database schemas default `enabled` to true. The scheduler's due query filters on enabled, so the storage error could activate a task the user requested disabled.
- GitNexus upstream impact for the controller and repository classes was LOW with zero indexed callers/processes. Method-level `create` and `createAsync` returned UNKNOWN on an index 277 commits stale; manual callers are the REST create route, repository create users, and scheduler due selection. No HIGH or CRITICAL result.
- This fix does not backfill previously created schedules: their original checkbox intent cannot be recovered from persisted true rows. No operator schedule was read or mutated; all tests used in-memory SQLite. The Postgres INSERT branch was updated and typechecked but not exercised against a live Postgres instance. Private packaged no-model Recon remains pending the next source build.
