---
date: 2026-08-27
repo: Rhythm
branch: fix/optimizer-generator-lanes
pr: 1489
issues: [1480, 1481, 1483, 1484]
status: awaiting-final-sandbox
tags: [run, Rhythm]
---

# PR #1489 final harness race repair

## Acceptance

WAIVED: test-harness-only race repair with no production behavior change; verification is static harness/adversarial/focused tests, live normal skip/fail-closed checks, build/tsc/diff gates, and the sandbox owner’s final live rerun.

## Files

- `apps/api_server/src/__tests__/_s4_harness_rows.ts` — stable broad/install table snapshots, exact row-field diffs, and bounded 250 ms settlement polling.
- `apps/api_server/src/contract/pr_1489_harness_race_repair.test.ts` — five static checks for ordering, scoped diffs, late-update settlement, bounded diagnostics, and exact install snapshots.
- `apps/api_server/src/__tests__/live_e2e_1480_1481_1483_1484.test.ts` — waits for prior optimizer streams, narrows invalid provenance invariants to the install surface, keeps broad changes diagnostic, and restores the strict final broad/file baseline after settled cleanup.
- `docs/ai/contracts/pr-1489-cleanup-repair.json` and `pr-1489-final-harness-repair.json` — final sandbox status and maintained commands.

## Diagnostic design

- Broad snapshot: 6 tables — `agent_configs`, `agent_cookbook`, `agent_skills`, `agent_org_proposals`, `agent_sessions`, `agent_session_messages` — ordered by `id`.
- Install snapshot: 3 tables — `agent_configs`, `agent_skills`, `agent_profile_projections` — ordered by `id` or `profile_id`.
- Settlement requires two byte-identical broad snapshots 250 ms apart within 10 seconds. Timeout output contains only changed table, row key, status, and changed fields.
- Invalid provenance still proves zero fixture requests, exact target profile equality, zero target skill rows, byte-identical install snapshots, and byte-identical managed/projected files. Broad session/message drift is warning-only diagnostics.
- The positive control snapshots/restores only the declared install surface and files.
- `afterAll` settles first, deletes every newly enumerated engine session plus suite-created rows/files, settles again, then compares the full broad snapshot and file digest to the original baseline. The final equality remains strict.

## Checks

- `npx vitest run src/contract/pr_1489_harness_race_repair.test.ts` — 1 file, 5/5 passed.
- `npx vitest run src/contract/pr_1489_harness_race_repair.test.ts src/contract/pr_1489_adversarial_review.test.ts` — 2 files, 20/20 passed.
- `npx vitest run src/contract/issue_1483.test.ts src/services/__tests__/org_proposal_appliers_wiring.test.ts src/services/generators/__tests__/external_discovery_generator.test.ts src/__tests__/agent_configs_routes.test.ts src/repositories/agent_configs_repository.test.ts` — 5 files, 123/123 passed.
- `npx vitest run src/__tests__/live_e2e_1480_1481_1483_1484.test.ts --no-file-parallelism` — 1 file and 3 tests skipped normally.
- `RHYTHM_LIVE_E2E=1 npx vitest run src/__tests__/live_e2e_1480_1481_1483_1484.test.ts -t "pr-1489-c16-c20" --no-file-parallelism` — expected nonzero; isolation guard rejected missing `RHYTHM_LIVE_E2E_ISOLATED=1` and the real DB path before fixture/network setup.
- `node_modules/.bin/tsc --noEmit` — passed.
- `npm run build` — passed, including postbuild.
- `git diff --check` and contract JSON parsing — passed.
- Production-source diff — empty; all source changes are under `src/__tests__` or `src/contract`.
- GitNexus impact for the live test, `rowDigest`, and `tableDigest` and final change detection were attempted against `Rhythm`; the connected v41 reader cannot open the v42 index, so risk is `UNKNOWN` with no HIGH/CRITICAL result.

## Handoff

- PR #1488 owns the sandbox; this run neither started nor used it.
- Live criteria remain `UNVERIFIED` / awaiting final sandbox. The existing S4 live command is ready for the owner’s final serial rerun.
- No production code, push, merge, or sandbox lifecycle change is included.
