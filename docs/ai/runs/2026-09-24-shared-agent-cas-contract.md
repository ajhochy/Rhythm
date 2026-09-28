---
date: 2026-09-24
repo: Rhythm
branch: codex/shared-agent-api-contract
pr: 1544
issues: []
status: pending
tags: [run, rhythm]
---

# Canonical shared-agent CAS acceptance contract

## Files

Replaced rejected shared-agent HTTP bridge tests and fictitious issue-0 contract with plan-based SA2-AC1 through SA2-AC8. Added gated API+engine behavioral test. No product implementation or new route.

## Checks

`cd apps/api_server && npx vitest run src/__tests__/shared_agent_api_slice2_contract.test.ts src/__tests__/shared_agent_cas_live.test.ts`

Exit 1: **4 failed, 3 passed, 1 skipped**. Intended RED: same-revision competitors both return 200; invalid revision null returns 200; stale revision returns 200; unknown revisioned patch field returns 200. Preservation, security/preset constraints, and legacy omission controls pass. First fixture run hit missing required icon; fixture corrected before this reported meaningful RED run. Log: `/private/tmp/shared-agent-cas-red.log`.

`npx tsc --noEmit -p tsconfig.json` passed after correcting explicit JSON response types in the live test. Dev Dashboard recorded pending run, revision 5252.

No server started. Live test remains unrun until the parent-owned combined sandbox campaign; it checks real engine registry prompt after concurrent edits and rejects stale overwrite. Gated behind RHYTHM_LIVE_E2E and explicit isolated loopback URL, with synthetic API-created profile cleanup only. Use sanctioned sandbox fixture/path settings from AGENTS.md.

GitNexus impact lookup for replaced setupAgent test helper returned unknown/not indexed (197-commit stale sibling warning). No production symbol was edited, no commit made.

## Notes

Contract-schema.md was read. Parent explicitly requires plan-based IDs without invented issue number, so contract records contract_id/plan/PR and omits issue. All criteria remain pending. Downstream effect spies cover rejection isolation at controller boundary only; the gated test supplies the required actual API/engine proof later. Full native Hermes execution, shared host editors, capability transport and two-way delegation remain mandatory.

## Implementation candidate

Base `98550b60f0dac4106e4e3f4fdeb5b0e8ce1b9bd0`, branch `codex/shared-agent-api-contract`, uncommitted product diff in existing controller/repository only. Optional expectedRevision uses the repository's existing fixed-column mapping plus an atomic SQL revision predicate and RETURNING. Existing validation, preset/security restrictions, downstream effects and legacy omission remain. Conflict returns before projection/reload/broadcast. Revisioned unknown top-level fields reject; raw omitted advanced JSON is preserved. No new route, transport, compiler or owner claims.

GitNexus controller patch LOW (0 indexed callers); repository update MEDIUM (13 direct, 19 upstream, 2 flows); stale index 197 commits behind. Existing compareAndSetColumnsAtRevision considered but left unchanged to avoid duplicating the existing update field mapping. `git diff --check` clean.

First implementation action replayed RED: `/private/tmp/shared-agent-cas-impl-red.log`, 4 failures/3 pass/1 skipped. After implementation:

- `npx vitest run src/__tests__/shared_agent_api_slice2_contract.test.ts src/__tests__/shared_agent_cas_live.test.ts`: 7 pass, 1 gated skip, exit 0 (`/private/tmp/shared-agent-cas-green.log`).
- `npx vitest run src/__tests__/agent_configs.test.ts src/__tests__/w1_corrective_6_revisions.test.ts src/__tests__/org_proposal_apply.test.ts src/__tests__/shared_agent_api_slice2_contract.test.ts src/__tests__/shared_agent_cas_live.test.ts`: 177 pass, 1 gated skip, exit 0 (`/private/tmp/shared-agent-cas-neighbors.log`).
- `npx vitest run src/__tests__/agent_configs_routes.test.ts src/__tests__/issue_1135_audit_lock_contract.test.ts src/__tests__/agent_configs_export_import.test.ts`: 56 pass, exit 0 (`/private/tmp/shared-agent-cas-routes.log`). Parent explicitly authorized disposable isolated HTTP fixtures; no actual api_server/engine runtime launched.
- `npm run build`: TypeScript compilation and postbuild exit 0 (`/private/tmp/shared-agent-cas-build.log`). API lint is a configured TODO placeholder, not real lint evidence.

Verification-gate applied to focused evidence; **aggregate/live acceptance remains pending**, no full PASS. SA2-AC8 is ready for parent combined campaign; do not mark native/shared-agent feature complete. No commits/push.

## Parent integration

The parent reviewed both product diffs and the local/live tests. Integrated replay of the two contract files passed 7 tests and skipped the opt-in live API/engine case. The source change uses existing routes and validation, a fixed column map and a revision predicate in the SQL update. The full API suite passed at the preceding Engraph repair commit; that aggregate did not include this new CAS slice. New combined qualification remains required.
