# Rhythm — Project State

## Current focus

The six-stream open-issue workflow is complete. Four implementation draft PRs await AJ review/manual smoke, and the docs-only #1485 recipe-workflow plan is finalized for a fifth draft PR. No PR from this workflow is merged.

## Active branch / PR

- `fix/session-list-and-task-board` → draft PR #1486; fixes #1466, #1476, #1477, and #1475.
- `fix/bridge-stream-reliability-repair` → draft PR #1487; fixes #1457, #1458, #1455, #1456, and #1325.
- `fix/optimizer-scope-lane` → draft PR #1488; fixes #1479 and #1482.
- `fix/optimizer-generator-lanes` → draft PR #1489; fixes #1480, #1481, #1483, and #1484.
- `plan/recipes-1485` → docs-only #1485 plan/review/state branch; draft PR not yet opened.

## In progress

- AJ-owned review, manual smoke, and merge decisions for draft PRs #1486–#1489.
- #1485 implementation has not started. The approved order is S0 durability probe → S1a migration/default-off plus S1b validator → S2 `dispatchAgentStage()` seam → S3 runner/completion/DTO → S4 dedicated-repo E2E → S5 Flutter editor. S0–S3 are unblocked.
- Verification workflow corrections are recorded in Rhythm-owned `verification-gate` and `workflow-orchestrator` skills: pre-run `UNVERIFIED` triggers execution, and exact worktree, fixture variables, launch ownership, and readiness are mandatory.

## Risks / known issues

- GitNexus impact/detect calls were repeatedly attempted, but client v41 cannot read index v42. Risk remains UNKNOWN; there was no HIGH/CRITICAL result. This is a tooling follow-up, not a product gate pass.
- PR #1486 still needs subjective Electron/web versus Flutter child-session visual-parity smoke. Deferred tasks are excluded from Open after Done.
- Optimizer diagnosis still selects the global MRU profile rather than a named dedicated profile; this is documented in PR #1489 and intentionally not expanded there.
- Optional validator cleanup remains for a missing `find` MCP grant and a coding-agent contract-path variant.
- S4 requires private `ajhochy/rhythm-workflow-e2e` on `main`, a required `workflow-e2e` check, and observable OpenAI plus Anthropic provider metadata before it can run.

## Test status

- Initial triage: 60 open issues and 0 PRs. Twenty-three applicable D1–D4/C2-D issues in #1426–#1451, including tracker #1448, were verified on `main` and closed with evidence; backlog was 35 afterward.
- PR #1486: automated API, web, Flutter, and live gates pass; only subjective visual-parity smoke remains.
- PR #1487: 33/33 criteria; full API suite 5,999 passing; all live gates pass.
- PR #1488: 8/8 criteria and live 10/10. Read-only diagnosis found 16 phantom Obsidian grants across four profiles; no live rows changed.
- PR #1489: 24/24 criteria, 165 focused tests, live 2/2, and cleanup/integrity checks pass.
- #1485: OpenAI-authored plan completed Anthropic Opus 5 contrarian review; required repairs are incorporated. This branch is docs-only.
- All sandboxes were cleaned; live ports 4001/4096 were preserved. Synthetic fixture v2 uses DELETE journaling, is read-only, and contains no secrets.

## Next step

1. AJ manually smokes #1486, then reviews/smokes #1487–#1489; merge decisions remain AJ-owned.
2. Decide when to begin #1485 S0 and independently shippable S1a.
3. Fix the GitNexus client/index version mismatch.
4. Optionally resolve the validator warnings for the missing `find` grant and coding-agent contract path.
