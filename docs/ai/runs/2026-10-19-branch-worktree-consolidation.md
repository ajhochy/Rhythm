---
index: "[[Rhythm]]"
date: 2026-10-19
repo: rhythm
branch: mega/2026-09-29-consolidation
pr: 1598
issues: []
status: verified-local
tags: [run, rhythm]
---

# Branch / worktree audit and consolidation

## Files / refs changed
- Worktrees 30 → 1; local branches 37 → 2 (`main`, mega).
- Before removal, every dirty worktree and every branch with commits outside origin/mega was snapshotted to a local tag:
  `archive/wt-<name>` (uncommitted state, parent = worktree HEAD) and `archive/branch-<name>` (tips). 33 tags.
- Mega fast-forwarded 224 commits to origin/mega, then merged origin/feat/hermes-shipping-rollout-20261014 (#1617, clean),
  origin/fix/anthropic-plugin-cc-version (#1618, clean), origin/fix/relay-uplink-heartbeat (#1601; resolved
  `app.ts` imports and `relay_uplink_server.ts` — kept the per-frame `stampUplink()` with mega's `handleFrame(frame, connection)`).
- Main checkout's uncommitted memory-freshness code was an older draft of what mega already has (50ebd40e onward);
  kept mega's version for all 8 conflicted files. Its two draft tests fail against mega's API and were dropped
  (kept in `archive/wt-main-checkout`). Recovered 19 docs files (runs/decisions/plans) committed as 59a1b24c.

## Checks
- Relay tests: 4 files, 43 passed. `npx tsc --noEmit` clean.
- `ai-workflow checks --level pr`: run 1 and 2 failed; run 3 PASS, 22/22 gates, EXIT=0.
- api_server on temp DB/ports 4019+4029: `/health` ok, `/agents/capabilities` 200.

## Repair loop
- Failures were environment, not code: node_modules dated 2026-09-28 (better-sqlite3 12.8 vs lock 13.0.3; fork missing
  fast-xml-parser). Root `npm ci` then hoisted typescript/tsx out of `apps/api_server/node_modules`, which the check
  script and `mcp_tool_grant_drift`/`skill_usage_tracker` tests hard-code; fixed with `npm ci --workspaces=false` in
  api_server. Mobile Playwright bump needed `npx playwright install chromium`. No follow-up issue filed.

## Notes
- Not merged on purpose: #1610 (superseded by later Coordinator rewrite; 11-file conflict), #1604/#1615/#1616
  (contained in mega or superseded by #1617), wip/g2-c2-partial and wip/mobile-canonical-backend snapshots,
  Oct 1–8 Codex experiment worktrees (features later rebuilt in mega; leftovers archived only).
- Initial worktree removal and stash were refused by the auto-mode classifier; AJ then added a permission rule.
- Nothing pushed; no GitHub state changed.

## Follow-up: standalone clones and copies under ~/Documents/Codex
- `git worktree list` missed 88 Rhythm checkouts under `~/Documents/Codex/2026-10-01..10` (60 local clones chained
  off each other, 28 plain copies without `.git`), all dated Oct 1–5.
- Archived before deletion: 35 dirty clones → `archive/clone-*`, 28 plain copies → `archive/copy-*` (no parent),
  every clone branch tip → `refs/clonescan/*`. The other 25 clones were clean with no commits outside mega/main/archive.
- Deleted all 88 (AJ approved; 31 GB freed). Kept: `Codex/2026-10-19`, hermes repos, `~/Documents/hermes-rhythm-plugin`.
- ~27 GB remains in Codex Oct 1–10: build outputs/evidence (candidate `.app` builds, iOS QA evidence, Dayflow release), not source.
