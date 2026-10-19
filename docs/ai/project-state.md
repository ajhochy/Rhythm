# Rhythm — project state

## Current focus
One integration branch. The 2026-10-19 audit folded every open PR's unmerged work into
`mega/2026-09-29-consolidation`; it is the single candidate for `main`
([run log](runs/2026-10-19-branch-worktree-consolidation.md)).

## Active branch / PR
`mega/2026-09-29-consolidation` @ `3c24078b` (local; push pending AJ OK) → `main` via
[draft PR #1598](https://github.com/ajhochy/Rhythm/pull/1598). Contains #1617 (Hermes shipping rollout),
#1618 (Claude Code ccVersion), #1601 (relay uplink heartbeat). Only `main` and mega exist locally; one worktree.
Installed app: `/Applications/Rhythm.app` 0.18.76.

## In progress
- Local build storage guard installed (10 GiB monitored combined scratch/output budget); generated-file cleanup plus separate archived-source consolidation reduced Codex folder accounting about 268 → 27 GiB. Pool currently 1.01 GiB, no active builds. Installed app and local backups preserved; old source work is archived. See [tooling run](runs/2026-10-19-build-storage-budget.md); tooling changes remain local and uncommitted.
- Push mega, then close superseded PRs #1601 #1604 #1610 #1615 #1616 #1617 #1618 pointing at #1598.
- #1598 CI last failed `fork-checks` (pre-push head); re-check after push.
- Decide whether to commit `tools/dev/hermes_*` operator scripts (saved in tag `archive/wt-hermes-shipping-rollout-20261014`).
- Hermes 0.18.77 qualification build/restart still needs AJ's artifact-specific restart permission.

## Risks / known issues
- Old worktree/branch/copy work exists in local `archive/*` tags (96), plus `refs/clonescan/*`. Not pushed — don't delete them.
- #1610 (Coordinator conversation repairs) was not merged: conflicts with 11 files mega rewrote when retiring the bounded coding layer; treat as superseded unless a specific fix is missing.
- Check script and two tests hard-code `apps/api_server/node_modules/{typescript,tsx}`; a root workspace `npm ci` hoists them away. Reinstall api_server with `npm ci --workspaces=false`.
- Mac full-app quit/install/relaunch permission not yet asked; preserve old signed app for rollback.
- Coordinator runs use bypassPermissions confined to their worktree; approval list hides expired cards (1 h window).
- 3,795 historical NULL-owner sessions not backfilled; 8 pre-existing FK orphans in agent_session_messages.

## Test status
2026-10-19 on `59a1b24c`: `ai-workflow checks --level pr` — all 22 gates PASS (EXIT=0) after dependency reinstall.
Built api_server on temp DB: `/health` ok, `/agents/capabilities` 200.
Storage tooling on the current local source: 20 process tests, 28 focused Node
checks and four issue gates pass. Broad guarded PR run: 21/22 batches pass;
three #1186 temp-path fixture failures pass in a separate approved 100 MiB
guarded OS-temp fixture (7/7). This qualifies tooling, not an installed release.

## Next step
AJ OK → push mega, close superseded PRs, confirm #1598 CI green, manual smoke of a build from mega, then AJ merges #1598.
