---
date: 2026-08-27
repo: Rhythm
branch: fix/optimizer-generator-lanes
pr: 1489
issues: [1480, 1481, 1483, 1484]
status: pass
tags: [run, Rhythm]
---

# PR #1489 adversarial review repair

## Files

- Added `src/contract/pr_1489_adversarial_review.test.ts` and its 15-criterion contract.
- Grounded every diagnosis fix type, capped `unverified-claim` away from full skill rewrites, filtered/logged infrastructure signals in both lanes, and stopped non-retry recipe churn.
- Enforced allowed origin/scheme/40-hex commit pin/hash at `installSkill`; simplified installed-skill overlap to candidate title plus downloaded body.
- Derived routing prose from projected permissions and restored the empty-roster non-development constraint.
- Deleted the source-text harness contract and made the live digest walker type-aware/fail on unreadable files.
- Replaced the failed ad-hoc origin/scheme probe with `pr-1489-c16-c20` in the existing env-gated S4 Vitest suite. It calls the real `buildRealExternalAdoptionDeps().installSkill`, counts fixture downloads, proves invalid provenance cannot mutate rows/files/profile state, and runs a valid pinned/hash-matching positive control before restoring exact digests.

## Checks

- `WAIVED: test-harness-only repair with no product behavior change; verification is executable env-gated Vitest coverage, fail-closed isolation, focused checks, and one final owner-run sandbox pass.`
- RED: `npx vitest run src/contract/pr_1489_adversarial_review.test.ts` — **15 failed / 15**, including F1 config bypasses, F2 install-boundary bypass, and all three F4 roster contradictions.
- GREEN: same command — **15 passed / 15**.
- Focused: 12 files, **215 passed / 215**.
- Broader optimizer: 20 files, **186 passed / 186**.
- `node_modules/.bin/tsc --noEmit` — exit 0.
- `npm run build` — exit 0.
- `git diff --check` — exit 0.
- Sandbox/live gate intentionally not started: dispatch reserved the shared sandbox for later serial verification.
- Harness repair direct evidence: `npx vitest run src/contract/pr_1489_adversarial_review.test.ts` — **15 passed / 15**.
- Focused external-adoption evidence: `npx vitest run src/contract/issue_1483.test.ts src/services/__tests__/org_proposal_appliers_wiring.test.ts src/services/generators/__tests__/external_discovery_generator.test.ts` — **33 passed / 33**.
- Normal env-gated behavior: `npx vitest run src/__tests__/live_e2e_1480_1481_1483_1484.test.ts --no-file-parallelism` — **3 skipped / 3**.
- Fail-closed evidence: `RHYTHM_LIVE_E2E=1 npx vitest run src/__tests__/live_e2e_1480_1481_1483_1484.test.ts --no-file-parallelism` — expected nonzero before test execution; isolation guard refused the real DB because `RHYTHM_LIVE_E2E_ISOLATED=1` was absent.
- `node_modules/.bin/tsc --noEmit` — exit 0.
- `npm run build` — exit 0.
- `git diff --check` — exit 0; only the S4 live test, PR #1489 contract, and this run note changed.
- Final isolated live result: 3/3 passed at `ef7bf436`, including the real install boundary, zero-request rejection, positive pinned install, exact cleanup, and manager projections.

## GitNexus

Impact was attempted before edits for `generateWorkflowSignalProposals`, `proposeCreateRecipeForCategory`, `proposeFixFromSignals`, `isInfraSignal`, `runExternalDiscoveryGenerator`, `ExternalCandidate`, `searchSkillCandidates`, `RHYTHM_SKILLS_DOWNLOAD_BASE`, `buildRealExternalAdoptionDeps`, `buildHubRoutingPreamble`, `injectManagerPreamble`, `titleSimilarity`, and `treeDigest`.

Every call failed with: `Database file version: 42, Current build storage version: 41`; risk was `UNKNOWN`, with no HIGH/CRITICAL result. The harness-repair impact attempts covered `buildRealExternalAdoptionDeps`, `startFixture`, and `fileDigest`; final `detect_changes(scope=all, worktree=...)` also failed for the same index-version mismatch rather than being skipped.

## Notes

- The global-MRU diagnosis-profile follow-up remains deferred and documented in PR #1489.
- No push, merge, or sandbox start was performed.

## Commits

- `f277366a` — external skill adoption provenance boundary.
- `5651dde1` — workflow proposal evidence grounding and churn closure.
- `ae29c237` — manager routing consistency, adversarial contracts, and evidence cleanup.
