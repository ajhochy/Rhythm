---
date: 2026-08-19
repo: Rhythm
branch: agent-stack/si-d2-post-apply-lifecycle
pr: 1454
issues: [1435]
status: ready-for-verification
tags: [run, Rhythm]
---

## Contract

- Contract: `docs/ai/contracts/issue-1435.json`.
- Red run: `npx vitest run src/services/__tests__/post_apply_lifecycle.integration.test.ts --no-file-parallelism` — **1 file / 3 tests failed** because successful approvals created no post-apply event.
- Green run: same command — **1 file / 3 tests passed**.
- Repair red runs: the 3-file metadata command failed **2 delegation cases** with missing `postApplyTarget`; the route/lifecycle command returned **HTTP 500** for both injected enrollment failures before the production catches were added.
- Final contract command is the 11-file serial command in `docs/ai/contracts/issue-1435.json` — **11 files / 231 tests passed**; all direct eligibility, exclusion, isolation, and lifecycle criteria pass.

## Files changed

- Final uncommitted D2.5 ownership is **29 files** (24 tracked modifications + 5 untracked additions); all are within the existing D2.5 lifecycle/applier/direct-test/docs boundary.
- Added `post_apply_lifecycle.ts`, its real-SQLite integration contract, and the env-gated live E2E.
- Composed existing monitor/repair/revert seams with explicit profile metadata from config/scope appliers.
- Added reversible delegation metadata and post-commit enrollment-failure isolation at both controller exits.
- Added direct eligibility/exclusion, no-recursion, readiness, isolation, overlap, boundedness, measurement-exclusion, and Postgres-gate evidence.
- Added bounded actionable-event listing, atomic monitoring claims, measurement exclusion, scheduler ownership, awaited revert, safe repair/alert audit shapes, and measuring-original revert support.
- Updated focused repository/service tests and the contract/state/run documentation.
- `org_proposal_reconciler.ts` was not modified.

## Persisted assertions

- Repair success: one event, one applied repair proposal, original active, repaired config retained, no alert/revert.
- Exhaustion: exactly three repair rows/IDs, original config restored byte-exact, original proposal reverted, event tripped/reverted, safe alert persisted.
- Expiry: event clear/not-needed, original active, no repair/alert; later errors and another sweep are terminal no-ops.
- Bearer sentinel is absent from every new event field, repair proposal title/rationale/change JSON, alert payload, and captured lifecycle warnings.

## Falsification evidence

- Disabled `registerAutoRepairTrigger(repair)` → integration contract red: repair ID counts were `0` instead of `1`/`3`.
- Disabled `finalizePostApplyLifecycleAsync` enrollment → integration contract red: all three event lookups were `null`.
- Removed `await` from the auto-revert trigger → integration contract red: exhausted event still had `revertStatus='none'` when the lifecycle returned.
- Removed delegation `postApplyTarget` → **2/12 delegation tests red** on exact missing tool metadata.
- Removed the generic controller enrollment catch → focused route test red with **HTTP 500 instead of 200** and the injected secret reaching the global error path.
- Invoked the mocked `org_proposal_measure.measureProposal` seam after each enrollment rejection → both generic and scope rows red on `expect(measure).not.toHaveBeenCalled()` (**2 failed / 24 passed, 26 total**), proving the mock imported before `createApp()` binds both controller branches; the invocation was then removed.
- Removed the lifecycle-owned measure guard → focused tripped case red because `rerunScenario` executed.
- All temporary mutations were restored before final checks.

## Checks run

- `cd apps/opencode_fork && bun install --frozen-lockfile` — pass, 4,659 packages; no tracked lock/dependency drift.
- `tools/dev/sandbox.sh up && tools/dev/sandbox.sh status` — pass, API `4098`, engine `4097`, gateway `4099`.
- Required metadata/apply suite — **3 files / 136 tests passed**.
- Required controller/lifecycle suite — **5 files / 68 tests passed**.
- Explicit excluded-lane suite — **3 files / 27 tests passed**.
- Original D2 serial suite — **5 files / 39 tests passed**.
- Final c12 focused route command, `npx vitest run src/__tests__/org_proposals_routes.test.ts --no-file-parallelism` — **1 file / 26 tests passed**; the generic and scope enrollment-rejection rows each directly assert the pre-controller-import `org_proposal_measure.measureProposal` mock had zero calls.
- Final issue-1435 contract command documented in `docs/ai/contracts/issue-1435.json` — **11 files / 231 tests passed** after the c12 repair.
- `node_modules/.bin/tsc --noEmit` — pass.
- `npm run build` — pass.
- `npm test` — **696 files: 583 passed, 5 failed, 108 skipped; 5,700 tests: 5,512 passed, 7 failed, 181 skipped**. The seven failures are the documented baseline in `issue_1219_memory_provenance` (2), `delegation_caller_identity` (1), `issue_1135_audit_lock_contract` (1), `memory_index_rebuild` (1), and `memory_injection` (2).
- `RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 RHYTHM_LIVE_URL=http://127.0.0.1:4098 ... npx vitest run src/__tests__/post_apply_lifecycle_live_e2e.test.ts --no-file-parallelism` — **1 file / 1 test passed** against the sandbox DB; public approval enrolled one event and the existing minute scheduler cleared it and activated the proposal.
- First live invocation from the repo root failed before test collection (`sh: vitest: command not found`); the cleanup trap removed the sandbox and listener checks passed. The corrected invocation from `apps/api_server` then passed as recorded above.
- `git diff --check` — pass.
- `node -e "JSON.parse(require('node:fs').readFileSync('docs/ai/contracts/issue-1435.json', 'utf8'))"` — pass.
- `git status --short --branch` — expected pre-existing D2.5 ownership only; this repair changed no production source and touched only the existing route test, issue-1435 contract, and D2.5 run note.
- Tracked `apps/opencode_fork/{bun.lock,package.json}` diff — empty.
- GitNexus pre-edit symbol lookup was stale: delegation/controller only resolved at file level and the new lifecycle file was absent, so this repair is classified **MEDIUM/UNKNOWN**, never low.
- GitNexus final `detect_changes(scope=all)` reported 24 changed indexed files but 0 resolved symbols/processes; treat this as **MEDIUM/UNKNOWN** due stale indexing, not proof of low risk.

## Notes

- SQLite owns enrollment and sweeps. Postgres returns without constructing the SQLite repository.
- Diagnosis readiness defers repair without consuming attempts; thrown diagnosis calls also return `deferred` rather than exhausting/reverting.
- New audit/log persistence stores IDs, safe fixed outcomes, and a patch-value SHA-256 only. Authoritative config values and reversible proposal snapshots remain unchanged as approved exceptions.
