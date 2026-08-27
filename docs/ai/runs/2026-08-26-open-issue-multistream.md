---
date: 2026-08-26
repo: Rhythm
branch: plan/recipes-1485
pr: 1490
issues: [1325, 1455, 1456, 1457, 1458, 1466, 1475, 1476, 1477, 1479, 1480, 1481, 1482, 1483, 1484, 1485]
status: complete
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# Open-issue multistream workflow

## Files changed

- `docs/ai/current-plan-recipes-1485.md` — finalized implementation sequence, extraction boundary, roster, contracts, and S4 preconditions.
- `docs/ai/decisions/2026-08-26-recipe-extraction-boundary.md` — ratified minimal shared dispatch seam and recipe-owned durability.
- `docs/ai/decisions/2026-08-26-recipe-workflow-approval-guards.md` — scoped workflow-only approval relaxation and accepted security tradeoff.
- `docs/ai/reviews/2026-08-26-recipes-1485-contrarian.md` — Anthropic Opus 5 contrarian review of the OpenAI-authored plan.
- `docs/ai/runs/2026-08-26-retro-verification-metadata-lifecycle.md` — verification workflow retrospective.
- `docs/ai/project-state.md` — current cross-stream snapshot.
- `docs/ai/runs/2026-08-26-open-issue-multistream.md` — final workflow record.

## Checks run

- Triage began at 60 open issues and 0 PRs. Twenty-three applicable D1–D4/C2-D issues in #1426–#1451, including tracker #1448, were verified on `main` and closed with evidence; backlog was 35 afterward.
- PR #1486 (`fix/session-list-and-task-board`): automated API/web/Flutter/live gates pass for #1466/#1476/#1477/#1475. Subjective child-session visual parity remains manual.
- PR #1487 (`fix/bridge-stream-reliability-repair`): 33/33 criteria, full API 5,999 passing, and all live gates pass for #1457/#1458/#1455/#1456/#1325.
- PR #1488 (`fix/optimizer-scope-lane`): 8/8 criteria and live 10/10 pass for #1479/#1482. Read-only reporting found 16 phantom Obsidian grants across `fantasy-gm`, `money`, `worship-production`, and `graphic-designer`; no live rows changed.
- PR #1489 (`fix/optimizer-generator-lanes`): 24/24 criteria, 165 focused tests, live 2/2, and cleanup/integrity checks pass for #1480/#1481/#1483/#1484.
- All sandboxes were cleaned and live ports 4001/4096 remained preserved. Synthetic fixture v2 was DELETE-journal, read-only, and free of secrets.
- GitNexus impact/detect calls were attempted repeatedly but failed because connected client v41 cannot read index v42. Risk is UNKNOWN, with no HIGH/CRITICAL result; this does not count as a product gate pass.
- PR #1490 adversarial findings F1–F18 were verified against source and repaired in the docs-only plan; `git diff --check` passed for the repair turn.

## Notes

- No PR was merged. AJ retains manual-smoke and merge ownership.
- #1485 was reopened after PR #1490 review returned ACCEPT WITH REQUIRED REPAIRS. Revised order permits S0, S1a, S1b, and S2 in parallel where files allow, then S3a nonconsequential durability, S3b security/enforcement, S4 dedicated-repo E2E, and S5 after S1b plus the stable S3 DTO.
- S4 requires a fine-grained PAT limited to `ajhochy/rhythm-workflow-e2e`, explicit sandbox `GH_TOKEN`/`GITHUB_TOKEN` override, base `main`, required check `workflow-e2e`, and observable OpenAI plus Anthropic assistant-message metadata.
- AJ settled all reserved product decisions. Remaining facts are S0 recovery behavior, generator-file collision coordination, isolated repository credential/check permissions, and provider/message observability.
- Rhythm-owned `verification-gate` and `workflow-orchestrator` skills now treat pre-run `UNVERIFIED` as an execution trigger and require the exact worktree, fixture variables, launch ownership, and readiness checks. The detailed retrospective is linked above.
- PR #1486 excludes Deferred tasks from Open after Done. Its remaining smoke is subjective Electron/web versus Flutter child-session visual parity.
- Optimizer diagnosis still uses global MRU instead of a named dedicated profile; PR #1489 documents the follow-up without expanding scope.
- Optional validator follow-up: missing `find` MCP grant and coding-agent contract-path variant.
