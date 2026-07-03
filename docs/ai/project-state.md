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

- **#815** — VERIFICATION-ONLY (native ask-notification). Feature is fully implemented
  on main (`local_notification_service.dart` + `agents_controller.dart` #815 logic +
  `main.dart` tap→nav + `opencode_stream_bridge` question/permission handling). Needs a
  live smoke (role-scoped agent raises a question → macOS notification appears → click
  focuses the session), then close. No code in #882.
- Manual/AI **UI visual smoke** of the new surfaces (quick actions, Report Card,
  memory edit + provenance, nested Task-card nav, session-agent binding) — repo has no
  Flutter golden tooling, so this is the manual smoke step.

## Risks / known issues

- **Optimizer cron (#830) stays OFF.** #857 added the data-sufficiency guard
  (min 7-day window + 10-activity floor, env-overridable) + `active → reverted` revert
  path (`POST /agent-org-proposals/:id/revert`). Cron is still not seeded/enabled by
  construction — enable only after live confidence under the guard.
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

## Next step

1. Human review + merge **#882** (leave open until manual smoke).
2. Live-smoke **#815** (question → notification), then close it.
3. Manual UI smoke of the new surfaces.
4. Triage the follow-up backlog: #881 (quick), #870 + setup-agent wave #871–#880.
5. After merge, resolve `docs/ai/project-state.md` in favor of the branch copy.

## Filed this run (2026-07-02): #867 #870 #871 #872 #873 #874 #875 #876 #877 #878 #879 #880 #881 (see runs/2026-07-02-workflow-run-13-issues.md); #869 closed (no secret present)
