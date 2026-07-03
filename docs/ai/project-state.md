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
- **#884** `issue-884-gemini-tool-cap` (worktree `rhythm-worktrees/884-gemini`,
  parallel to #882) — Gemini 512-function-declaration cap fix, implemented and
  verified (commit `98a5be656`), NOT pushed/PR'd yet. See
  `runs/2026-07-02-884-gemini-tool-cap.md` and
  `decisions/2026-07-02-gemini-tool-cap-choke-point.md`.

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
- **#883** (secretary delegate authorization) implemented in isolated worktree
  `883-secretary` / branch `issue-883-secretary-delegate`, commit `f33ecacd5`.
  verification-gate PASSED (see `docs/ai/runs/2026-07-02-issue-883-secretary-delegate.md`).
  Not yet folded into the mega branch. Fix: `rhythm_delegate` added to secretary's
  `.mcp-roles` tool scope + a new reproducible role-file → `agent_configs` backfill
  seed for `is_manager`/roster (previously DB-only, hand-edited via the designer).

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
- `issue-884-gemini-tool-cap` @ `98a5be656` (separate worktree, not folded into
  #882): api_server `tsc` clean + `npm run build` clean + vitest **2017 pass**
  / 1 skip / 0 fail (235 files); mcp_server build clean + **59 pass**
  (unaffected, confirms no cross-package regression). No Flutter/Dart files
  touched. GitNexus `detect_changes` unavailable for this worktree (not in
  its indexed repo list) — fell back to `git diff --stat main...HEAD` to
  confirm change scope.
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
5. After merge, resolve `docs/ai/project-state.md` in favor of the branch copy.
6. Push `issue-884-gemini-tool-cap` and open a PR (currently local-only,
   verified). Manual smoke idea once merged: force a session onto the
   `google` route with a large/unscoped MCP profile and confirm no "At most
   512 function declarations" error, plus a `[GeminiToolCap]` warning log
   line when trimming occurs.
5. Fold **#885** (worktree ready, see In progress) into the next integration branch; live
   Settings-screenshot follow-up still outstanding.
6. After merge, resolve `docs/ai/project-state.md` in favor of the branch copy.

## Filed this run (2026-07-02): #867 #870 #871 #872 #873 #874 #875 #876 #877 #878 #879 #880 #881 (see runs/2026-07-02-workflow-run-13-issues.md); #869 closed (no secret present)

## Recent coding-agent runs

### 2026-07-02 — #870 (rhythm_create_issue MCP tool)
- Files modified:
  - `apps/mcp_server/src/tools/githubIssues.ts` (new) — `registerGithubIssueTools`; POSTs directly to
    `https://api.github.com/repos/{repo}/issues` (no api_server hop, no new deps — global `fetch`).
  - `apps/mcp_server/src/tools/githubIssues.test.ts` (new) — 8 tests: registration, happy path
    (asserts URL/headers/body + number+url return), `GITHUB_TOKEN` fallback, `RHYTHM_GITHUB_REPO`
    override, missing-token error, empty/whitespace title validation, oversized-body validation,
    GitHub 4xx surfaced as `isError: true`.
  - `apps/mcp_server/src/index.ts` — import + `registerGithubIssueTools(server)` call (no apiUrl/token
    args passed through; the tool reads GitHub creds from env itself).
- Checks run:
  - `npm run build` (tsc --noCheck) — clean.
  - `npm run typecheck` (tsc --noEmit) — clean.
  - `node_modules/.bin/vitest run` — **67 pass** (59 pre-existing + 8 new), 0 fail.
- Decisions made:
  - Went with issue Option A (first-class MCP tool) per the issue's own recommendation.
  - Token resolution: `RHYTHM_GITHUB_TOKEN` then `GITHUB_TOKEN` fallback, read at call time inside the
    tool (never passed into `registerGithubIssueTools`, never touches `opencode.json`). Missing token
    throws before any network call — no hallucinated success.
  - Repo defaults to `ajhochy/Rhythm`, overridable via `RHYTHM_GITHUB_REPO` env var.
  - Scoping: did **not** edit any `.mcp-roles/*.mcp.json` file. `dev.mcp.json` already grants
    `"allowedTools": ["*"]` on the `rhythm` MCP server, which automatically covers the new tool — it's
    the only dev-facing profile with wildcard access, so no other role needed (or should get) an
    explicit grant. All other roles keep narrow, task-specific allowlists.
  - Validation caps: non-empty (trimmed) title required; body capped at 60,000 chars — both checked
    before any fetch call, returned as `isError: true` tool errors.
- Deviations from spec: none — implemented Option A exactly as issue described (direct GitHub REST
  call from mcp_server, env-sourced token, scoped to dev role only).
- Concerns: no live smoke against the real GitHub API (network calls are mocked in tests, per the
  worktree's no-side-effects constraint). Recommend a one-time manual `rhythm_create_issue` smoke
  test with `RHYTHM_GITHUB_TOKEN` set before relying on this in a live agent session.
### 2026-07-02 — #880 Agent Profile export/import
- Files modified: `apps/api_server/src/controllers/agent_configs_controller.ts` (added
  `export`/`import` handlers), `apps/api_server/src/routes/agent_configs_routes.ts`
  (registered `GET /agent-configs/export` and `POST /agent-configs/import` ahead of
  `/:id`, same pattern as the existing `sync-opencode` route).
- Files added: `apps/api_server/src/services/agent_config_export_import.ts` (bundle
  schema v1, secret-pattern export guard, upsert-by-id import with preset
  protection + no-op detection), `apps/api_server/src/__tests__/agent_configs_export_import.test.ts`
  (9 contract tests: export shape, secret-pattern scan, id-filtering, create,
  update, preset-skip, round-trip, idempotent re-import, version-reject).
- Checks run: `tsc -p tsconfig.json --noEmit` clean; targeted vitest
  (`agent_configs_export_import` + `agent_configs_routes` + `agent_local_auth_bypass`)
  35/35 pass; `agent_profile_sync*` suites 113/113 pass; full api_server suite
  **2018 pass / 1 skip** (pre-existing #881 machine-local skip, unrelated).
- Decisions made: issue #880's body describes a `rhythm profile export/import`
  **CLI** (depends on `rhythm doctor`/`rhythm setup`, neither of which exist in
  this repo — that's a different, aspirational setup-agent-wave issue body that
  doesn't match this codebase). Implemented instead, per explicit dispatch
  instructions, as an HTTP API on the existing `agent_configs` local-agent-server
  router: `GET /agent-configs/export[?ids=...]` and `POST /agent-configs/import`.
  Collision policy: **upsert by id** (never remap); preset rows (claude-code/
  codex/gemini-cli/opencode) are always reported `skipped` and never overwritten,
  mirroring the PATCH route's `PRESET_PROTECTED_FIELDS` protection. Import
  triggers `syncOpencodeAgentProfiles()` once after all rows are written so
  imported profiles register with the opencode engine. No Flutter UI was added —
  out of scope per dispatch ("the API is the core deliverable").
- Deviations from spec: the GitHub issue's literal acceptance criteria (CLI
  subcommands, `rhythm doctor` integration, cross-OS bundle portability, secure
  interactive key-prompting) do not apply to this codebase's actual shape and
  were not implemented as written — see decision above. The delivered contract
  (versioned JSON bundle, no secret values, upsert-by-id, idempotent re-import)
  satisfies the *spirit* of the acceptance criteria adapted to `agent_configs`.
- Concerns: `.mcp-roles/*.mcp.json` files exist but are keyed by *agent name*,
  not by `agent_configs.id` — import does not attempt to sync or validate
  against `.mcp-roles`, since `allowedMcpsJson` is already the profile-level
  scope mechanism and importing a profile does not change which `.mcp-roles`
  file (if any) a session-create call resolves. Also: the worktree's root
  `node_modules` symlink was missing (only `apps/api_server/node_modules` and
  `apps/mcp_server/node_modules` existed), which broke `better-sqlite3` /
  `pg` / `ws` / `resend` resolution for both `tsc` and `vitest` region-wide —
  added `node_modules -> /Users/ajhochhalter/Documents/Rhythm/node_modules`
  (same symlink-to-main-checkout pattern as the two existing ones, gitignored,
  not part of the commit) so this worktree's checks can run at all.
