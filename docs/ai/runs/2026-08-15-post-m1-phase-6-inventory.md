---
date: 2026-08-15
repo: Rhythm
branch: codex/react-electron-live-suite
pr: null
issues: []
status: pass
tags: [run, Rhythm, post-m1, phase-6, inventory, contract]
---

# Post-M1 Phase 6 capability inventory and contract

## Files

- Created `docs/ai/coverage/react-electron/phase-6-files-diffs-search-worktrees-inventory.md`.
- Created `docs/ai/contracts/post-m1-phase-6.json` with 24 pending executable sub-criteria.
- Created this run note.
- Modified no code, tests, existing contracts, project state, branch, index, or remote state.

## Checks

- Read Phase 6 from `docs/ai/plans/2026-08-15-post-m1-parity-phases.md` before the capability walk.
- Read Flutter only from `origin/main` (`9fa2761ed78159f83f56982c03fcd85dc035039a`) using read-only `git ls-tree` and `git show`.
- Walked Flutter composer attachments, `@` search, Files/Changes inspector tabs, session creation/branch/worktree controls, controllers, data source, and session models.
- Walked React `Composer.tsx`, `Inspector.tsx`, `ToolWorkspace.tsx`, `SessionRail.tsx`, store transport, session gateway, and canonical React types.
- Walked the specified API tests/routes/controller, generated SDK declarations, and fork file/VCS/worktree/session-part implementations.
- Confirmed the existing false-success evidence: isolated hard-delete returned 204 while engine `removeWorktree` logged 400; branch residue required explicit cleanup.
- Parsed `docs/ai/contracts/post-m1-phase-6.json` as JSON, checked unique criterion IDs, verified all 24 statuses are `pending`, and checked the three requested paths are the only files created by this unit.
- Per unit constraints, ran no test suite, parity generator, verification runner, Playwright, GUI, server, or port operation.

## Notes

The inventory found six Flutter capabilities missing from React live mode:

1. Real native file selection, classification, and canonical live attachment delivery.
2. Server-side session/worktree `@` search and attachment.
3. Live Files browsing/search/status/content preview.
4. Live session/VCS diffs, raw patch export, and revert/restore.
5. Live branch discovery/selection/create/stash plus preserved resolved worktree identity.
6. Live worktree reset/remove with observable server results.

React does already send `isolateWorktree` and optional `worktreeName` on live session creation and retains the returned worktree directory as session `cwd`. That existing capability was not falsely listed as missing. Complete hard-delete cleanup is separately recorded as a shared backend defect rather than padded into the Flutter-only count.

The contract makes Git cleanup three independent assertions: registry membership (`git worktree list --porcelain`), exact filesystem existence, and exact branch-ref existence. HTTP 204 and database-row deletion are explicitly insufficient.
