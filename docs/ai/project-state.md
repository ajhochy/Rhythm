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
- **#888** (quick-action buttons spawned "Coding Workflow" instead of Secretary,
  silently breaking #883's delegation): committed to `workflow/run-2026-07-03`.
  Two rounds: (1) `quick_actions_bar.dart` passes `agentId` alongside `mcpRole`;
  (2) **live-smoke fix** — the first round resolved `agentId` from
  `managerAgent`, but production has TWO `isManager=true` configs (secretary +
  the dev `workflow-orchestrator`), so it picked the wrong manager and spawned
  workflow-orchestrator. Now resolves Secretary by its stable slug via a new
  `AgentConfigsController.secretaryAgent` getter, guarded by a two-manager
  regression test (`test/features/agent_configs/agent_configs_controller_test.dart`).
  Postmortem: `.agent-stack/postmortems/2026-07-03-issue-888.json` (C2 — fixture-
  convenient test: the widget fake had a single manager). See
  `docs/ai/runs/2026-07-03-issue-888-quick-actions-agentid.md`. Note: #888 is
  Flutter-only and does NOT touch `apps/api_server` — the `server.ts` /
  `auth_credential_watcher.ts` changes on this same branch belong to the
  unrelated #856 fix below (a prior run's note conflating the two was
  mistaken; corrected here).
- **#856 (reopened)** (engine did not pick up refreshed Claude credentials
  after a `claude` CLI re-auth): on branch `workflow/run-2026-07-03`.
  Round 1 (a file watcher, commit `15f36db38`) was the WRONG mechanism — live
  smoke proved current `claude` stores creds in the macOS Keychain only and
  does not persist the local creds file, so the watch never fires on a real
  re-auth. Round 2 (this rework) replaces it with a change-gated **Keychain
  poll** in `CredentialsBridgeService` (`startKeychainPoll`, default 60s via
  `CLAUDE_KEYCHAIN_POLL_MS`): it fingerprints the Keychain refresh token each
  tick and force-re-bridges only when it changes, self-healing past the
  transient denial seen during a logout→login. The `#658` 15-min loop and the
  opencode-`auth.json` watcher are untouched. See
  `docs/ai/decisions/2026-07-03-keychain-poll-replaces-file-watch.md`.
  Outstanding: live re-smoke of an actual `claude` re-auth (see Risks).

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
  release run; **#868** oMLX provider needs the oMLX app installed to live-smoke. All unit-covered.
- **#856 (reopened, round 2 — Keychain poll):** polling `security
  find-generic-password` every ~60s could in theory prompt for Keychain access
  on some machines (not observed; the `#658` loop already reads it every 15
  min without incident, but the tighter cadence widens exposure). Not yet
  re-smoked against a live `claude` logout→login (unit-tested only). Manual
  smoke: re-auth with the app running, watch for `"keychain poll: refresh
  token changed — re-bridged ok"` in the server log within ~60s (no restart),
  then confirm a new agent session doesn't error on expired Claude creds.

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
- `workflow/run-2026-07-03` @ `a832ea277` (working tree, uncommitted — #888 Flutter
  half + #856-reopened backend fix, both verification-gate PASSED independently):
  `ai-workflow checks --level pr` green — flutter analyze 0 errors + `dart format`
  clean + **793 Flutter pass**; api_server `tsc` clean + **2336 vitest pass / 1
  skip / 0 fail** (273 files, the #881 machine-local skip only).

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
7. Commit + push `workflow/run-2026-07-03` (currently uncommitted: #888
   Flutter fix + #856-reopened backend fix, both verification-gate PASSED)
   and open a PR closing both issues. Manual smoke before merge: (a) tap a
   quick-action button and confirm it spawns Secretary, not Coding Workflow
   (#888); (b) run `claude` to re-auth and confirm the server log shows
   "claude re-auth detected — re-bridged: ok" with no app restart needed
   (#856).

## Filed this run (2026-07-02): #867 #870 #871 #872 #873 #874 #875 #876 #877 #878 #879 #880 #881 (see runs/2026-07-02-workflow-run-13-issues.md); #869 closed (no secret present)

## Recent coding-agent runs

### 2026-07-03 — #856 (reopened, SECOND attempt): file-watch replaced with change-gated Keychain poll
verification-gate pending (about to run). This supersedes the "2026-07-03 —
#856 (reopened)" entry immediately below: LIVE SMOKE proved the file-watch
fix was the wrong mechanism — the current `claude` CLI stores credentials in
the macOS **Keychain ONLY**; `claude logout`/`login` deletes any stale
`~/.claude/.credentials (JSON)` and never recreates it, so the file-watcher
essentially never fires on a real re-auth (it fired once, by luck, on the
stale file's *deletion*, hitting a transient `keychain_denied`). The Keychain
cannot be `fs.watch`ed.
- Files modified:
  - `apps/api_server/src/services/credentials_bridge_service.ts` — added
    `refreshTokenFingerprint()` (SHA-256 of the refresh token, never logs/
    exposes the raw token), `startKeychainPoll()`/`stopKeychainPoll()`
    (injectable `KeychainPollDeps` seam), and a `lastBridgedRefreshFingerprint`
    baseline that `bridgeAnthropic()` now updates on every successful bridge
    (launch-time, "Reconnect", the #658 refresh loop, or the poll itself) so
    the poll never redundantly re-fires for a token it didn't cause. Default
    interval 60s, env-overridable via `CLAUDE_KEYCHAIN_POLL_MS`.
  - `apps/api_server/src/server.ts` — removed the `claudeCredentialWatcher`
    (`AuthCredentialWatcher` on `~/.claude/.credentials (JSON)`) block and its
    shutdown `.stop()`; the launch-time Claude auto-bridge block now also
    calls `credentialsBridge.startKeychainPoll(opencodeClient)` unconditionally
    (even when no creds exist yet at launch, so a later first-time sign-in is
    also picked up), and the shutdown handler calls
    `credentialsBridgeRef?.stopKeychainPoll()` via a module-scope ref captured
    at launch (the shutdown handler is synchronous, so it can't `await
    import()` the route module fresh). The ORIGINAL `#856` `auth.json`
    watcher (opencode's own provider-credential file) is UNTOUCHED and still
    running.
  - `apps/api_server/src/services/auth_credential_watcher.ts` — removed the
    dead `claudeAiOauth`-shape branch from `authIdentityFingerprint` (it
    normalized `~/.claude/.credentials (JSON)`'s shape, which is now unused
    since nothing watches that file anymore). Kept: the opencode-auth.json
    fingerprint/decision logic and the pre-existing `content === null` →
    `' null'` sentinel (no stray NUL reintroduced).
  - `apps/api_server/src/services/auth_credential_watcher.test.ts` — removed
    the 3 `claudeAiOauth`-shape fingerprint tests AND the "Claude credentials
    watcher wiring" describe block (3 more tests) that exercised the
    now-removed `~/.claude/.credentials (JSON)` `AuthCredentialWatcher` wiring
    in `server.ts` — that wiring no longer exists, so those tests were dead
    coverage for removed code, not just the literal 3 named in the dispatch.
    Kept every other pre-existing test (opencode auth.json fingerprint +
    decision + integration tests) unchanged. 16 tests remain, all pass.
  - `apps/api_server/src/services/credentials_bridge_service.test.ts` (new)
    — 11 tests: fingerprint determinism/uniqueness/non-exposure; unchanged
    fingerprint → bridge not called; changed fingerprint → forced re-bridge
    exactly once + baseline updates so the next unchanged tick is a no-op;
    transient null-read and thrown-error failures → bridge not called, no
    exception escapes, existing baseline untouched, self-heals on next good
    tick; a failed (`success:false`) bridge doesn't update the baseline so
    the next tick retries; idempotent start; `stopKeychainPoll` clears the
    interval; the interval handle is `unref()`'d.
- Checks run: `npx tsc --noEmit` — clean. `npx vitest run
  src/services/credentials_bridge_service.test.ts
  src/services/auth_credential_watcher.test.ts` — **27/27 pass**. Also ran
  the pre-existing `src/__tests__/credentials_bridge_service.test.ts` (the
  #658 bridge/refresh-loop suite, untouched, outside this issue's file list)
  to confirm no regression from `bridgeAnthropic` now also setting the
  fingerprint baseline — **16/16 pass**. Fail-before/pass-after confirmed via
  `git stash` on `credentials_bridge_service.ts` alone: all 11 new poll tests
  fail with `startKeychainPoll is not a function` before the implementation,
  pass after.
- Decisions made: see
  `docs/ai/decisions/2026-07-03-keychain-poll-replaces-file-watch.md` — why
  polling (change-gated) instead of file-watching, why the fingerprint
  baseline lives on `bridgeAnthropic` success rather than only inside the
  poll tick, why the poll starts unconditionally at launch instead of only
  when `hasClaudeCode()` is true.
- Deviations from spec: none — matches the dispatch's required behavior
  (poll default ~60s env-overridable, change-gated on refresh-token
  fingerprint, transient-failure self-heal, unref'd timer, existing #658 loop
  and the original opencode-auth.json watcher both left intact).
- Concerns: not yet live-smoked against a real `claude logout`/`login` cycle
  (unit-tested only, per this dispatch's no-real-Keychain constraint) — see
  Risks below for the manual-smoke item, including a macOS permission-prompt
  risk from polling `security` every ~60s.

### 2026-07-03 — #888 (quick-action buttons spawn Coding Workflow instead of Secretary) — Flutter half
verification-gate PASSED. Full detail moved to
`docs/ai/runs/2026-07-03-issue-888-quick-actions-agentid.md`. Summary: both
quick-action `createSession(...)` call sites in `quick_actions_bar.dart` now
also pass `agentId` (resolved via `AgentConfigsController.managerAgent?.ocAgent
?? 'secretary'`) — previously only `mcpRole: 'secretary'` was passed, which
only scopes MCP tools, not which engine agent runs the session; the server
defaulted to "Coding Workflow" instead of Secretary. Flutter: 793/793 pass,
0 errors, format clean. Not yet committed. Backend half (server-side
`agentId`/`mcpRole` resolution) owned by a separate concurrent agent — see the
`#856` entry immediately below for that agent's own in-flight work.

### 2026-07-03 — #856 (reopened): engine does not pick up refreshed Claude credentials after `claude` re-auth
verification-gate PASSED. Full detail moved to
`docs/ai/runs/2026-07-03-issue-856-reopened-claude-reauth.md`. Summary: the
original #856 watcher only watched opencode's `auth.json`, which a `claude`
CLI re-auth never touches (it writes the Keychain + the local Claude Code
credentials file instead) — so the watch never fired, and even a bounce
never re-invoked `bridgeAnthropic`. Fix: added a second
`AuthCredentialWatcher` on the Claude Code credentials file whose `onReload`
forces `credentialsBridge.bridgeAnthropic(client, { force: true })`;
extended `authIdentityFingerprint` to parse that file's `claudeAiOauth`
shape. `apps/api_server` `tsc` clean, full vitest **2336 pass / 1 skip**
(273 files). Not yet committed.

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
