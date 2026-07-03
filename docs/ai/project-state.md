# Project State

## Current focus

The 2026-07-02 governance/safety + agent-UX + infra closeout is complete and parked
in **PR #882** (open, CI-green) for review. It resolves the risk backlog the prior
mega build-out exposed (#856–#860) plus agent-UX and infra hardening — 13 issues,
implemented by parallel worktree-isolated coding agents (contract-first) and folded
sequentially with the full check suite between folds.

## Active branch / PR (open — never auto-merge)

- **#882** `workflow/run-2026-07-02` → main. CI green (Server + MCP + Desktop).
  Closes on merge: #857 #859 #860 #862 #858 #861 #863 #865 #814 #856 #864 #867 #868.
- This run branched off merged `main` (mega build-out already merged: #848/#849/#835).

## In progress

- Manual smoke COMPLETE (2026-07-02, 7/7 items PASS after in-run fixes): quick actions
  (#863: cwd + feedback/nav fixed), Report Card (#865 — surfaced #884), memory edit +
  integrated Context-tab provenance (#862 — #886 source_id convention fixed), Task-card
  → existing local child session (#861 — link-first + directory-scoped reads), child
  identity (#867 — specialist parsed from title + 31-row backfill), tool cards default
  collapsed, **#815 verified live and CLOSED** (question → macOS notification →
  click-to-focus). All fixes on #882; CI green on the final commit.
- **#885 done in worktree** `issue-885-vault-env` @ `ea1c53595` (not yet folded/PR'd):
  desktop app now injects `MEMORY_VAULT_PATH`/`MEMORY_VAULT_SUBDIR` into the spawned
  agent api_server, auto-detecting the Obsidian `AGENT-MEMORY` vault when present (falls
  back to the legacy path otherwise); explicit env vars still win. New
  `MemoryVaultConfigService` + Settings UI section. See
  `docs/ai/runs/2026-07-02-885-memory-vault-env.md` and the linked decision doc. Follow-up
  outstanding: a live `flutter run -d macos` screenshot of the new Settings section
  (blocked in-run by a port/DB collision with another running instance) and manual
  migration/prune of the 3 stale legacy Memory-Vault notes (intentionally not automated).

## Risks / known issues

- **Optimizer cron (#830) is actually SEEDED-ON, not off.** Correction (found in
  #882 smoke): `org_optimizer_seed.ts` (from the mega build, unchanged this run) seeds
  "Org Self-Optimizer" (daily @ 02:00) + "Org External Discovery" (weekly) at every
  startup, persisted in the scheduler DB — the earlier "off by construction" claim was
  wrong. #857 added the data-sufficiency guard (min 7-day window + 10-activity floor,
  env-overridable) + `active → reverted` revert path, so the daily audit is now SAFE
  **when running #857 code** (in #882). RISK: the guard is not on `main` yet — if the
  cron fires @ 02:00 against un-merged main code it can over-prune on thin data (the
  original #857 incident). External Discovery stays human-gated (HIGH-risk, queued).
  DECISION (2026-07-02, maintainer): leave the cron ON — **merge #882 before 02:00** so
  the guard is on main; it then runs autonomously under the data-sufficiency guard +
  revert (full-autonomy-with-rollback). No enable-flag gate added.
- **#881 (test fragility):** `opc_curated_mcp_ensure.test.ts` c1 hardcodes
  `toHaveLength(5)` but #835's `...loadLocalCuratedMcpServers()` makes the array include
  machine-local sidecar entries. Fails locally on any box with a gitignored
  `curated_mcp_servers.local.json`; PASSES on CI (clean runner). Fix the assertion.
- **#870:** Rhythm has no GitHub-issue-filing capability (no tool/scoped MCP/shell) —
  agents can't self-file issues. Proposed: scoped `rhythm_create_issue` MCP tool.
- **Parallel-worktree node_modules hazard:** symlinking one `node_modules` across
  worktrees + agents running `npm ci` concurrently races/corrupts it. Give each
  worktree its own install, or forbid reinstalls in agent prompts (used here). See
  the run log.
- **#814 bundling** (`desktop_release.yml` mcp_server steps) not yet exercised by a real
  release run; **#856** engine bounce not yet exercised by a real account-switch;
  **#868** oMLX provider needs the oMLX app installed to live-smoke. All unit-covered.

## Test status

- PR #882 @ `784c7abc7`: api_server `tsc` clean + vitest **1996 pass** / 1 skip / 1 fail
  (the #881 machine-local test — passes on CI); mcp_server build clean + **59 pass**;
  Flutter analyze **0 errors** + `dart format` clean + **773 pass**. CI: all 3 green.
- Worktree `issue-885-vault-env` @ `ea1c53595` (#885, not yet folded): `ai-workflow checks
  --level issue` and `--level pr` both PASS. Flutter: **793 pass**, 0 fail (18 new).
  api_server vitest: 234/234 files, 2008 pass / 1 skipped, 0 fail on a clean standalone
  run (one `issue_755_role_separation.test.ts` timeout flaked under `--level pr`'s full
  parallel load, confirmed unrelated — this branch touches zero `apps/api_server` files).

## Next step

1. Human review + merge **#882** (leave open until manual smoke).
2. Live-smoke **#815** (question → notification), then close it.
3. Manual UI smoke of the new surfaces.
4. Triage the follow-up backlog: #881 (quick), #870 + setup-agent wave #871–#880.
5. Fold **#885** (worktree ready, see In progress) into the next integration branch; live
   Settings-screenshot follow-up still outstanding.
6. After merge, resolve `docs/ai/project-state.md` in favor of the branch copy.

## Filed this run (2026-07-02): #867 #870 #871 #872 #873 #874 #875 #876 #877 #878 #879 #880 #881 (see runs/2026-07-02-workflow-run-13-issues.md); #869 closed (no secret present)
