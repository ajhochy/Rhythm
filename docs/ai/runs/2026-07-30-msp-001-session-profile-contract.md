---
date: 2026-07-30
repo: Rhythm
branch: codex/msp-001-session-profile-contract
pr: null
issues: [MSP-001]
status: live-unverified
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# MSP-001 authoritative session/profile contract

## Files changed

- Added distinct branded Rhythm profile and OpenCode agent IDs to API and
  mobile provider contracts.
- Added nullable `agent_sessions.profile_id` with SQLite migration and
  Postgres bootstrap parity.
- Added safe paired profile catalog and owner/project-scoped session-state
  update routes.
- Reconciled engine session agent/model data into the local session catalog
  and attached safe authoritative state to paired session responses.
- Changed paired mobile profile discovery, hydration, prompting, commands,
  shell execution, and approval updates to use per-session state.
- Added the R5 catalog contract at
  `docs/ai/contracts/msp-001-safe-profile-catalog.md`.
- Kept every `agent_sessions_repository.ts` edit in isolated commit
  `c2cc1aec8`; `upsertChildSession` was not changed.

## Checks run

Red contract baseline:

```text
cd apps/api_server
npx vitest run src/contract/msp_001_session_profile_contract.test.ts src/contract/msp_001_profile_catalog_contract.test.ts
# 7 failed

cd apps/mobile
node --test tests/contract/msp-001-session-profile-contract.test.mjs
# 2 failed
```

Green automated checks:

```text
cd apps/api_server
./node_modules/.bin/tsc --noEmit
# exit 0

./node_modules/.bin/vitest run \
  src/repositories/agent_sessions_repository.test.ts \
  src/contract/msp_001_session_profile_contract.test.ts \
  src/contract/msp_001_profile_catalog_contract.test.ts \
  src/__tests__/mobile_gateway_postgres_schema.test.ts \
  src/__tests__/migrations_replay_guard.test.ts \
  src/__tests__/migrations_self_heal.test.ts
# 6 files passed, 35 tests passed

cd apps/mobile
./node_modules/.bin/tsc --noEmit
# exit 0

node --test \
  tests/contract/msp-001-session-profile-contract.test.mjs \
  tests/provider-utils.test.mjs
# 3 tests passed
```

The pre-existing HTTP-boundary suites could not bind an ephemeral loopback
listener in the managed workspace (`listen EPERM`). Their in-process proxy
contract assertions were run separately; the MSP-001 contract itself does not
open a listener.

## Live test — written, not run

The required live test is
`apps/api_server/src/__tests__/msp_001_session_profile_live.test.ts`.
Per the workstream safety contract, this session did not run
`tools/dev/sandbox.sh`, start either backend, or bind ports 4096–4098.

Command for the orchestrator after it has brought up the isolated sandbox:

```bash
cd apps/api_server
RHYTHM_LIVE_E2E=1 \
RHYTHM_LIVE_URL=http://127.0.0.1:4098 \
RHYTHM_LIVE_DEVICE_TOKEN='<sandbox-device-token>' \
RHYTHM_LIVE_PROJECT_ID='<sandbox-project-id>' \
npx vitest run src/__tests__/msp_001_session_profile_live.test.ts
```

## Notes

- GitNexus impact and `detect_changes` could not run because the indexed MCP
  tools were unavailable and the local wrapper requires blocked network
  package resolution. Manual call-site review was used, but this remains a
  verification gap.
- The verification gate remains open until the orchestrator runs the live test
  against the rebuilt isolated engine/API and records the observable result.
- R1 integration point: child-session profile inheritance remains intentionally
  deferred to serialization after R1's `upsertChildSession` change.
