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

### 2026-07-02 — #883 secretary delegate authorization (worktree `883-secretary`, branch `issue-883-secretary-delegate`)
- Files modified:
  - `.mcp-roles/secretary.mcp.json` — added `rhythm_delegate` to the `rhythm`
    server's `allowedTools` (the actual reported gap: this file is read LIVE
    by `resolveMcpRole()` at session-create time, no separate sync needed for
    tool scope); added new `isManager: true` + `allowedDelegates` (roster:
    theologian, librarian, worship-planning, worship-production,
    AI-Trend-Researcher, Theological-Researcher, fantasy-gm) fields.
  - `.mcp-roles/README.md` — documented the new `isManager`/`allowedDelegates`
    role-file fields and how they reach `agent_configs`.
  - `apps/api_server/src/services/secretary_delegation_seed.ts` (new) —
    backfill-only reconciliation: sets `agent_configs('secretary').is_manager`
    / `.allowed_delegates_json` from the role file's new fields, but ONLY when
    the column is still at its unset default (never clobbers a value already
    set via the Agent Profiles designer — same USER-OWNED overlay contract as
    `agent_profile_sync.ts`).
  - `apps/api_server/src/services/agent_profile_sync.ts` — added one call to
    `seedSecretaryDelegation()` at the end of `syncOpencodeAgentProfiles()`
    (alongside the existing #858 oc_agent repair pass), since that function —
    not server boot — is what actually creates/refreshes the `secretary` row
    (fires on every `GET /agent-sessions/agents` and
    `POST /agent-configs/sync-opencode`).
  - `apps/api_server/src/__tests__/secretary_delegation_seed.test.ts` (new),
    `apps/api_server/src/__tests__/secretary_delegation_authz.test.ts` (new).
- Checks run: `npx tsc --noEmit` (api_server + mcp_server) clean; `npx vitest
  run` full api_server suite — **2023 pass / 1 skip** (pre-existing #881
  machine-local flake, unrelated); `ai-workflow checks --level issue` — all
  green (flutter analyze, dart format, api_server tsc).
- Decisions made:
  - **Live DB already had a broad roster** (11 entries incl. UUIDs) set by
    hand via the Agent Profiles UI — the issue's "2 researchers + fantasy-gm"
    framing was stale. Chose the slug-keyed subset the issue asked for
    (theologian/librarian/worship-planning/worship-production + the two
    researchers by their opencode slug + fantasy-gm) as the CANONICAL
    role-file roster, using name slugs (not raw UUIDs) since `agent_configs`
    rows from `syncOpencodeAgentProfiles` are slug-keyed (`id = agent.name`)
    — sidesteps the "raw UUID" cosmetic issue noted in #883's minor
    observations (unresolved separately, relates to #858).
  - **System prompt already correct live** ("Delegate domain work to the
    approved specialist...") — confirmed via read-only DB inspection; no
    canonical source exists for it anywhere in the repo (it lives only in the
    live DB and in `~/.config/opencode/agents/secretary.md`, outside the repo
    and outside this worktree) so it was left untouched per the issue's
    "only touch if canonical source lacks it" instruction.
  - **Backfill hook placed in `agent_profile_sync.ts` rather than `server.ts`**
    because `syncOpencodeAgentProfiles` is NOT called at server boot in this
    codebase — it only runs on-demand (agent picker load / explicit sync
    endpoint). A boot-only hook would almost always no-op
    (`secretaryRowMissing`) since the row doesn't exist yet at boot.
- Deviations from spec: did not touch `agent_delegation_service.ts` or
  `apps/mcp_server/src/tools/agentDelegation.ts` — issue confirmed both are
  already correct.
- Concerns / residual risk:
  - The role-file roster (7 entries, slug-keyed) is NARROWER than the live DB
    roster (11 entries, some UUID-keyed) — by design (backfill-only, never
    clobbers), the live row is untouched by this change and keeps its current
    broader roster. The role file only matters for a FRESH database. If the
    live DB roster is ever reset to null, it will re-seed to the narrower
    7-entry slug roster, not the current 11-entry one — flag this if a future
    DB reset surprises anyone.
  - `~/.config/opencode/agents/secretary.md`'s `task:` permission block is a
    SEPARATE delegation mechanism (opencode engine's own subagent dispatch)
    from `agent_configs.allowed_delegates_json` (the `rhythm_delegate` MCP
    tool's authz, gated by `agent_delegation_service.ts`) — the two rosters
    can drift; out of scope for #883 but worth a future issue to reconcile.
  - The UUID-vs-name cosmetic issue in the Allowed-Delegates UI list (#883's
    "minor observations", relates to #858) was not addressed — left for a
    separate follow-up.
