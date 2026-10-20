---
date: 2026-10-20
repo: Rhythm
branch: test/feature-playwright-2026-10-19
pr: null
issues: []
status: repairing
tags: [run, Rhythm]
---

# Local schedule owner attribution

## Files

- `apps/api_server/src/routes/agentSchedulesRoutes.ts`: apply existing optional authentication to direct AGENT_LOCAL schedule requests; retain `requireAuth`'s verified Device-context gate for the paired mobile mount and the existing hosted route.
- `apps/api_server/src/__tests__/agent_schedules_local_auth_attribution.test.ts`: real Express/SQLite contract for valid and invalid Bearer tokens, forged body owner, ambiguous no-token ownership, and paired Device ownership.
- `apps/api_server/src/__tests__/agent_schedules_local_auth_live_e2e.test.ts`: env-gated sandbox API + real fork check using a disabled, strictly owned `[smoke]` schedule.

## Checks

- RED before product edit: `npm run build:guard -- /bin/zsh -f -c 'cd apps/api_server && npm test --silent -- --run src/__tests__/agent_schedules_local_auth_attribution.test.ts'` failed 2/4. Valid local Bearer produced HTTP 201 with `createdByUserId:null`; invalid Bearer produced HTTP 201 instead of 401. Ambiguous no-token and paired Device cases passed. Full output: `/private/tmp/rhythm-schedule-local-owner-red-20261020.log`.
- GREEN related contract: guarded `npm test --silent -- --run src/__tests__/agent_schedules_local_auth_attribution.test.ts src/__tests__/agent_schedules_enabled_create_contract.test.ts src/__tests__/issue_1173_mobile_tools_gateway.test.ts` passed 18/18; `/private/tmp/rhythm-schedule-local-owner-green-20261020.log`.
- Guarded API `tsc --noEmit -p apps/api_server/tsconfig.json` passed; `/private/tmp/rhythm-schedule-local-owner-tsc-20261020.log`. After adding the live test, the guarded focused normal suite passed 4/4 with the live case skipped and `tsc --noEmit` passed; `/private/tmp/rhythm-schedule-local-owner-final-focused-20261020.log`.
- Built the current fork with `bun run build --single` and API with `npm run build` under `npm run build:guard`; fork binary smoke passed. Full output: `/private/tmp/rhythm-schedule-local-owner-sandbox-build-20261020.log`.
- Live sandbox: created synthetic read-only source fixture with `node tools/dev/sandbox_fixture.mjs /private/tmp/rhythm-schedule-owner-fixture-20261020-a`. Ran `tools/dev/sandbox.sh up --foreground` under build guard on API 4098, engine 4097, gateway 4099 using the four explicit fixture/sandbox paths. With `RHYTHM_LIVE_E2E=1`, `RHYTHM_LIVE_E2E_ISOLATED=1`, `RHYTHM_LIVE_URL=http://127.0.0.1:4098`, `RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:4097`, and the sandbox DB path, guarded `npm test --silent -- --run src/__tests__/agent_schedules_local_auth_live_e2e.test.ts` passed 1/1. It observed healthy real engine, `/auth/me` owner, invalid Bearer 401, disabled schedule HTTP owner and SQLite owner. Output: `/private/tmp/rhythm-schedule-local-owner-live-20261020.log`.
- `tools/dev/sandbox.sh down` exited 0 and removed the sandbox. Sanitized diagnostics: `/private/tmp/rhythm-schedule-owner-sandbox-20261020-a.evidence.tzA6xK`.

## Notes

- The earlier signed-app private Recon on source `28bcc2aa44` observed a normal disabled schedule with response and SQLite `created_by_user_id:null` even though `/auth/me` showed owner 1 with a Bearer token. This came from the local schedule route's wholesale auth bypass; the controller already used only server-created `req.auth`, so the body could not select an owner.
- The shared `authenticateIfPresent` middleware resolves valid local/cloud Bearer tokens and fails closed on a present invalid token. For a truly absent token, it infers an owner only when exactly one local user's sessions are active; the new test preserves null for an ambiguous two-user case. The paired mobile mount arrives with server-verified Device context and is checked by `requireAuth` before the schedule controller.
- Registry and prior run-log review found the local schedule bypass was deliberate for tokenless desktop compatibility, but no prior record for this Bearer attribution gap. GitNexus route impact was UNKNOWN/0 and `authenticateIfPresent` LOW/0 with a stale index; manual blast radius is direct desktop schedule routes and the paired mobile nested mount. Neither middleware nor controller/repository ownership policy was weakened.
- No historical null-owner schedule is backfilled. The original actor cannot be inferred safely. The private Recon row is being cleaned separately from a stopped fixture by the integration owner; this run did not touch it. No schedule executed because the live fixture was disabled and removed by exact `[smoke]` ownership.
