---
date: 2026-08-26
repo: Rhythm
branch: fix/optimizer-generator-lanes
pr: null
issues: [1483]
status: ready-for-verification
tags: [run, Rhythm]
---

# #1483 S4 scorer/config-cleanup harness repair

## Files

- `apps/api_server/src/__tests__/live_e2e_1480_1481_1483_1484.test.ts`
- `apps/api_server/src/contract/task_s4_diagnosis_provider_harness.test.ts`
- `docs/ai/contracts/issue-1483.json`

No production source changed. S3 owns sandbox startup/execution; this run started no servers.

## Checks

- RED: `npx vitest run src/contract/task_s4_diagnosis_provider_harness.test.ts` — 3 failed, 1 passed before harness edits (missing exact Haiku route, scorer differentiation, and atomic cleanup).
- PASS: `npx vitest run src/contract/issue_1483.test.ts src/contract/task_s4_diagnosis_provider_harness.test.ts` — 2 files, 8 tests passed.
- PASS: `npx vitest run src/__tests__/live_e2e_1480_1481_1483_1484.test.ts --no-file-parallelism` — 1 file/2 tests skipped without live opt-in.
- PASS (expected refusal): `RHYTHM_LIVE_E2E=1 npx vitest run src/__tests__/live_e2e_1480_1481_1483_1484.test.ts --no-file-parallelism` failed at `_live_e2e_guard` because no isolation attestation was supplied.
- PASS: `npm run build`.
- PASS: `npx tsc --noEmit`.
- PASS: `git diff --check`; changed paths are test/contract/run docs only.

## Notes

- The fixture now owns exact `anthropic/claude-haiku-4-5` scoring and diagnosis routing, records both draft/candidate scorer requests, and returns 20/95 respectively.
- Cleanup reads only sandbox `home/.config/opencode/opencode.json`, restores only `provider.anthropic` via sibling temp write + atomic rename, refreshes, and compares every provider entry.
- GitNexus impact and change detection were attempted, but the local index was unavailable because LadybugDB file version 42 does not match client storage version 41.
- READY_FOR_VERIFICATION: S3 must run the env-gated live suite in its owned sandbox.
