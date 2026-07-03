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

## Next step

1. Human review + merge **#882** (leave open until manual smoke).
2. Live-smoke **#815** (question → notification), then close it.
3. Manual UI smoke of the new surfaces.
4. Triage the follow-up backlog: #881 (quick), #870 + setup-agent wave #871–#880.
5. After merge, resolve `docs/ai/project-state.md` in favor of the branch copy.

## Filed this run (2026-07-02): #867 #870 #871 #872 #873 #874 #875 #876 #877 #878 #879 #880 #881 (see runs/2026-07-02-workflow-run-13-issues.md); #869 closed (no secret present)

## Recent coding-agent runs

### 2026-07-02 — #873 + #877 + #878 (security, worktree `issue-873-877-878-security`)

- Files modified: see the three individual commits on this branch
  (`a37c7b8cf` #873, `a307af3c6` #877, `672fc4fd1` #878) for full lists. New
  module dir: `apps/api_server/src/security/` (context_scanner, injection_patterns,
  security_advisories, advisories.json, advisory_acks, command_blocklist,
  command_risk_classifier, command_approval, approval_store + tests for each).
  Integration edits: `rhythm_managed_skills.ts`, `opencode_agent_writer.ts`,
  `skill_apply.ts`, `opencode_skills_routes.ts` (#873); `server.ts`, `package.json`
  (postbuild copy step), `.github/workflows/server_ci.yml` (#877);
  `opencode_stream_bridge.ts`, `config/env.ts` (#878).
- Checks run: `tsc --noEmit` clean after each issue; full `vitest run` — 2120
  pass / 1 skip (pre-existing #881 machine-local test, passes on CI) after
  #878; `python3 -c "import yaml..."` validated `server_ci.yml`; manually
  built + ran `dist/server.js` twice (before/after a false-positive fix) to
  confirm real startup behavior, not just unit tests.
- Decisions made: the issue bodies referenced Python/pip prior art
  (hermes-agent) and non-existent "likely files" (`context_loader.ts`,
  `shell_tool.ts`, `doctor.ts`) — this is a Node/TypeScript repo, so all three
  were adapted to real chokepoints found via code search: #873 wired into
  `writeManagedSkill`/`writeAgentProfileFile` (where file content actually
  becomes model-loadable); #877's advisory format changed from
  `pip install` to `npm install` and scans `package-lock.json`; #878 wired
  into the existing `permission.asked`/`permission.updated` handling in
  `opencode_stream_bridge.ts` (the same #736 dispatch-guard chokepoint)
  rather than a new interception layer. See
  `docs/ai/decisions/2026-07-02-security-issues-873-877-878-adapted-to-node-stack.md`.
- Deviations from spec: #877's `rhythm doctor` CLI (setup-01) does not exist
  yet — only the startup-banner half was wired; `runAdvisoryCheck()` /
  `formatDoctorReport()` / `AdvisoryAckStore` are ready for `doctor` to call
  once setup-01 lands. #878's "smart" mode AI assessment is a local
  deterministic heuristic classifier (`command_risk_classifier.ts`), not an
  LLM call, per the issue's own data-safety constraint.
- Concerns: two real bugs were only caught by manually running the built
  server / re-checking test discrimination, not by the first pass of unit
  tests — see the decisions doc. Both are fixed and now regression-tested,
  but it's a signal that "vitest green" alone was insufficient for these
  three issues; the manual `dist/server.js` smoke should be repeated after
  any further edits to `rhythm_managed_skills.ts`, `opencode_agent_writer.ts`,
  or `opencode_stream_bridge.ts`. #878's bash-arg key name (`command`) was
  inferred from reading `apps/opencode_fork/packages/opencode/src/tool/shell.ts`
  read-only (never edited) — worth a real end-to-end smoke once an opencode
  engine is available in this environment, since the unit tests mock the
  event shape rather than exercising a live bash permission-ask.
