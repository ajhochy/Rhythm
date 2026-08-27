---
date: 2026-08-27
repo: Rhythm
branch: fix/optimizer-generator-lanes
pr: 1489
issues: [1480, 1481, 1483, 1484]
status: ready-for-verification
tags: [run, Rhythm]
---

# PR #1489 adversarial review repair

## Files

- Added `src/contract/pr_1489_adversarial_review.test.ts` and its 15-criterion contract.
- Grounded every diagnosis fix type, capped `unverified-claim` away from full skill rewrites, filtered/logged infrastructure signals in both lanes, and stopped non-retry recipe churn.
- Enforced allowed origin/scheme/40-hex commit pin/hash at `installSkill`; simplified installed-skill overlap to candidate title plus downloaded body.
- Derived routing prose from projected permissions and restored the empty-roster non-development constraint.
- Deleted the source-text harness contract and made the live digest walker type-aware/fail on unreadable files.

## Checks

- RED: `npx vitest run src/contract/pr_1489_adversarial_review.test.ts` — **15 failed / 15**, including F1 config bypasses, F2 install-boundary bypass, and all three F4 roster contradictions.
- GREEN: same command — **15 passed / 15**.
- Focused: 12 files, **215 passed / 215**.
- Broader optimizer: 20 files, **186 passed / 186**.
- `node_modules/.bin/tsc --noEmit` — exit 0.
- `npm run build` — exit 0.
- `git diff --check` — exit 0.
- Sandbox/live gate intentionally not started: dispatch reserved the shared sandbox for later serial verification.

## GitNexus

Impact was attempted before edits for `generateWorkflowSignalProposals`, `proposeCreateRecipeForCategory`, `proposeFixFromSignals`, `isInfraSignal`, `runExternalDiscoveryGenerator`, `ExternalCandidate`, `searchSkillCandidates`, `RHYTHM_SKILLS_DOWNLOAD_BASE`, `buildRealExternalAdoptionDeps`, `buildHubRoutingPreamble`, `injectManagerPreamble`, `titleSimilarity`, and `treeDigest`.

Every call failed with: `Database file version: 42, Current build storage version: 41`; risk was `UNKNOWN`, with no HIGH/CRITICAL result. Final `detect_changes(scope=all, worktree=...)` failed with the same v42/v41 mismatch rather than being skipped.

## Notes

- The global-MRU diagnosis-profile follow-up remains deferred and documented in PR #1489.
- No push, merge, or sandbox start was performed.

## Commits

- `f277366a` — external skill adoption provenance boundary.
- `5651dde1` — workflow proposal evidence grounding and churn closure.
- `ae29c237` — manager routing consistency, adversarial contracts, and evidence cleanup.
