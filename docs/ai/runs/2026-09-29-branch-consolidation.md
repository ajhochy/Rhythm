---
date: 2026-09-29
repo: Rhythm
branch: mega/2026-09-29-electron-orgreviewer
pr: 1594
issues: []
status: complete
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# Consolidate every branch, worktree and PR into main + mega PR #1594

## What changed

- Local mega was fast-forwarded to `integrate/mega-open-prs-2026-09-29` (7b0cba74), which already merged the three open units: System One router backend (#1596), the Electron Rhythm MCP bundle (#1597, merged into the old mega) and the MCP install on sign-in. Then it was pushed.
- #1596 was closed into #1594, and the #1594 body now lists the added work plus its smoke items.
- 14 GitHub branches were deleted, leaving `main` and the mega branch. 15 local branches were deleted and local `main` now tracks `origin/main`. 4 worktrees were removed. Stale `plugin/*` and orphaned `lane/*` and `local-1505a/*` tracking refs were pruned.
- Before deletion, #1588 (closed) was checked as superseded by #1589 (merged). Merge commits of #1587, #1589 and #1591 are in the mega. Every other branch tip was either an ancestor of the mega or patch-equivalent to it.

## Archive

Local tag `archive/branch-consolidation-2026-09-29` → 56bba8e7. Its tree is `main`'s. Its parents are the 2026-09-28 archive 702ce0cb (418 older tips) plus 8 tips not otherwise contained in the mega. All 263 deleted tips are reachable from the tag or the mega. The dirty state of `/private/tmp/rhythm-mega-mobile-build13` (regenerated PNGs and one untracked JSON) is kept as a stash, which is also a tag parent. Dropping that stash was declined by the permission classifier, so it is still in `git stash list`.

## Checks

- api_server + web `tsc --noEmit` clean. api_server `vitest` decision/router/MCP: 20 files, 239 passed. mobile jest router settings: 32/32.
- `ai-workflow checks --level pr`: green except three local-env failures that predate the merge: `native_runtime_guard` (Node 24.21 + better-sqlite3 12.8), mobile lint and mobile web e2e (`expo-image-picker` not installed locally).
- Electron `issue-1402` packaging test cannot run locally without the Hermes Desktop artifact. It did get past the new `mcp_server` build step.

## Notes

- The shell is zsh, so `$ARGS` does not word-split. Build `git commit-tree -p …` parent lists with an array.
