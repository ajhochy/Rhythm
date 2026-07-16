---
date: 2026-07-15
repo: Rhythm
branch: main
pr: none
issues: [1089]
status: implemented; awaiting verification-gate
tags: [run, rhythm]
---

## Files changed
- `apps/api_server/src/services/agentSchedulerService.ts`
- `apps/api_server/src/__tests__/compute_next_run_cron_tz.test.ts`
- `apps/api_server/src/services/__tests__/agent_scheduler_cron_tz_live.test.ts`

## Checks run
- `MEMORY_VAULT_SUBDIR=memory npx vitest run src/__tests__/compute_next_run_cron_tz.test.ts`
- `RHYTHM_LIVE_E2E=1 MEMORY_VAULT_SUBDIR=memory npx vitest run src/services/__tests__/agent_scheduler_cron_tz_live.test.ts`
- `npx tsc -p tsconfig.json --noEmit`

## Notes
- Cron expressions now match wall-clock time in the task timezone using cached `Intl.DateTimeFormat` parts; no new dependency added.
- Deployment note: restore the 7 temporary UTC-shifted cron expressions to natural local (`0 1`, `45 1`, `30 3`, `30 4`, `45 4`, `30 5`, `30 6`) once this fix is active, so they are not shifted twice. No production data changed here.
