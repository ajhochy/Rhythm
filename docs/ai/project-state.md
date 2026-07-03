# Project State

## Current focus

Issue #863 — one-tap, jargon-free agent quick actions attached to a task
(and to the dashboard). Implemented and verified in this worktree. Not
yet opened as a PR.

## Active branch / PR

- **`issue-863-quick-actions`** — branches directly off `main` (not the
  mega-828 branch). Implements #863. No PR opened yet.
- Commit `73756ead664c460a9018ce47516e8ae96638a9b1`.

## In progress

- PR for `issue-863-quick-actions` not yet opened — next step is to push
  the branch and open a draft PR, then hand off for manual smoke (see
  Next step).

## Risks / known issues

- No automated visual/screenshot smoke exists for Flutter in this repo
  (confirmed: no golden tests, no `visual-smoke*` script, no
  `.claude/launch.json`). Flutter UI changes are verified manually via
  `RHYTHM_LOCAL_SMOKE=1 flutter run -d macos` per
  `docs/testing/manual-smoke.md` §9 — this is a standing repo convention,
  not specific to this change.
- `AgentsDataSource.send()` silently drops a WebSocket frame if the
  channel is null, with no delivery confirmation. Quick Actions guards on
  `agentsController.connectivity.isWsDisconnected` before sending, which
  narrows but does not eliminate a race between the check and the send.
  Pre-existing repo-wide property, not introduced by this change. See
  `docs/ai/decisions/2026-07-02-quick-actions-send-vs-draft.md`.
- No widget test exists for `dashboard_view.dart`'s new quick-actions card
  specifically (no existing dashboard test harness to extend within this
  issue's scope) — verified via `flutter analyze` + manual code trace.

## Test status

- `flutter test` (full suite): 754/754 pass.
- `flutter analyze --no-fatal-infos`: 0 errors/warnings (267 pre-existing
  info-level lints, unchanged from baseline).
- `dart format . --set-exit-if-changed`: clean.
- Full detail: `docs/ai/runs/2026-07-02-issue-863-quick-actions.md`.

## Next step

1. Push `issue-863-quick-actions` and open a draft PR for #863 (do not
   merge — leave open for manual review/smoke per the repo's PR
   workflow).
2. Manual smoke handoff: `RHYTHM_LOCAL_SMOKE=1 flutter run -d macos`,
   then open a task's inspector (confirm "Quick Actions" renders 4
   buttons at the bottom of the right panel) and the Dashboard (confirm
   the quick-actions card appears for the next open task); tap "Help me
   finish this" and confirm a new agent session opens with the task's
   context pre-loaded and no typing required.
3. Only merge to `main` after the user confirms manual smoke passed.

## Filed this run (2026-07-02): #854 #855 #856 #857 #858 #859 #860 (see runs/2026-07-02-mega-buildout-fork-eval-memory.md)

## Recent coding-agent runs

### 2026-07-02 — issue #864 (MCP stateless-readiness audit)
- Files modified:
  - `docs/ai/decisions/2026-07-02-mcp-stateless-readiness.md` (new) — full audit
    of both MCP surfaces (our server `apps/mcp_server`, the opencode fork's MCP
    client `apps/opencode_fork/packages/opencode/src/mcp/index.ts`): transport,
    statefulness/session-identity assumptions, tool-list caching posture,
    Tasks-extension readiness, 7 enumerated breaking risks each with a
    recommended fix.
  - `apps/mcp_server/src/__tests__/mcp_capabilities_and_tool_registration.test.ts`
    (new) — 3 guard tests using a real `McpServer`/`Client` pair over
    `InMemoryTransport` (not a stub): no duplicate tool names across all 18
    registration functions in declared order, same tool set regardless of
    registration order, and `tools.listChanged: true` capability is advertised
    as documented.
- Checks run:
  - `npm run build` (tsc, mcp_server) — pass.
  - `vitest run` (full mcp_server suite) — 58/58 pass across 11 files
    (3 new + 55 pre-existing).
- Decisions made: guard test targets `apps/mcp_server` only (real SDK
  Client/Server pair, cheap) rather than the fork (would require building the
  fork binary — out of scope for "cheap guard" and against the
  vendored-subtree/build-pipeline constraint in `AGENTS.md`). See decision doc
  "Alternatives considered" for full reasoning.
- Deviations from spec: none — this issue was audit + doc + one cheap guard,
  as scoped; no production code was changed in either surface.
- Concerns: Risks 2 (fork tool-list cache has no TTL, notification-only
  invalidation), 4 (no Tasks-extension usage anywhere; two candidate
  long-running flows — `rhythm_start_research`, `rhythm_run_org_optimizer` —
  poll-by-id instead), and 5 (no auto-reconnect in the fork's MCP client) are
  documented but **not fixed** — they require fork-side changes gated by the
  `mcp-scope-*` patch convention, which is out of scope for this audit issue.
  Risk 6 (SDK version skew: server 1.29.0 vs fork 1.27.1) should be watched at
  the next SDK bump on either side.
### 2026-07-02 — #857 optimizer over-prune guard + revert-from-active (worktree issue-857-optimizer-guard)
- Files modified:
  - `apps/api_server/src/services/org_audit_service.ts` — added the #857
    data-sufficiency guard (`MIN_TIGHTEN_OBSERVATION_DAYS` default 7,
    `MIN_TIGHTEN_ACTIVITY_COUNT` default 10, both env-overridable via
    `ORG_OPTIMIZER_MIN_OBSERVATION_DAYS`/`ORG_OPTIMIZER_MIN_ACTIVITY_COUNT`) to
    `detectTightenGaps`; computed `observationDaysByProfile` from
    `agent_configs.createdAt` in `buildOrgAuditSnapshot`; evidence string now
    carries `observationDays=<n>` alongside `sessionCount=<n>`. `detectPruneGaps`
    (dead/drifted name) is untouched — never gated by the window, per spec.
    Exported `detectTightenGaps`/the two threshold constants for the smoke.
  - `apps/api_server/src/services/generators/scope_hygiene_generator.ts` —
    `parseTightenEvidence` regex extended to accept the new optional
    ` observationDays=<n>` evidence suffix (backward compatible).
  - `apps/api_server/src/repositories/agent_org_proposals_repository.ts` —
    state machine: added `active -> reverted` to `ALLOWED_TRANSITIONS` (was
    throwing "Illegal status transition 'active' -> 'reverted'" — the exact
    failure hit hand-reverting the 16 live proposals).
  - `apps/api_server/src/models/agent_org_proposal.ts` — doc comment updated
    for the new transition.
  - `apps/api_server/src/controllers/org_proposals_controller.ts` +
    `apps/api_server/src/routes/org_proposals_routes.ts` — new
    `POST /agent-org-proposals/:id/revert` human-triggered undo action (calls
    `org_proposal_apply.revertProposal`; 409 if proposal is not `active`).
  - `tools/release/org_optimizer_guard_check.ts` — added check (e)
    `checkThinHistoryNoAutoAppliedTighten`: a thin/unobserved profile produces
    zero tighten-scope gaps/proposals end-to-end through
    `generateScopeHygieneProposals`; a well-observed profile with a genuinely
    unused tool still produces one (proves the guard isn't a blanket
    suppression). `smoke_org_optimizer.sh` unchanged (just runs the harness).
  - `apps/api_server/src/__tests__/issue_857_contract.test.ts` (new) — 8
    contract tests for all 6 acceptance criteria (thin-history suppression,
    sufficient-history still fires, prune-scope unconditional, evidence
    surfaces the basis, revert-from-active succeeds, state-machine regression
    guards).
  - `apps/api_server/src/services/__tests__/org_audit_service.test.ts` —
    updated the pre-existing `issue-819-c4` tighten-gap test to backdate the
    profile + add 10 sessions (it was the exact thin-data shape #857 now
    correctly suppresses); added a new sibling test asserting the old
    shape now produces zero gaps.
  - `apps/api_server/src/__tests__/org_proposals_routes.test.ts` — two new
    route-level tests for `POST .../:id/revert` (happy path + 409 when not
    active).
- Checks run:
  - `node_modules/.bin/tsc --noEmit` — clean.
  - `vitest run` (targeted: scope_hygiene_generator, issue_831_contract,
    issue_857_contract, org_proposals_routes, agent_org_proposals,
    org_proposal_apply, org_audit_service, external_discovery_generator) —
    all pass.
  - `vitest run` (full suite) — 215 files / 1856 pass / 1 skip (0 regressions
    vs. the prior ~213/~1839 baseline).
  - `tools/release/smoke_org_optimizer.sh` — exit 0, all 5 checks `[PASS]`
    including the new thin-history-guard.
- Decisions made:
  - Used `agent_configs.createdAt` (profile age) as the observation-window
    proxy — there is no per-scope-entry grant timestamp in the schema, and
    the issue explicitly allows "days since the profile/tool grant".
  - Chose module-level env-overridable constants (matching the existing
    `SKILL_OVERLAP_THRESHOLD`/`DEFAULT_TRAILING_WINDOW_MS` pattern in this
    service layer) over adding new `env.ts` fields, since these are
    optimizer-internal tuning knobs, not app-wide config.
  - Kept `sessionCount` as the activity floor (not a separate "tool
    invocation count") — no per-tool-invocation ledger exists yet
    (`org_exercised_tools_resolver.ts`'s own doc notes the same gap); session
    count is the best available activity proxy already wired into
    `detectTightenGaps`.
  - Exposed `detectTightenGaps` + the two threshold constants from
    `org_audit_service.ts` (previously module-private) so the #831 smoke
    could exercise the guard directly — `buildOrgAuditSnapshot()` alone can't
    be smoke-tested for this in the tsx harness because `opencodeClient.isReady`
    is false with no real engine attached, which independently short-circuits
    `detectTightenGaps` regardless of the new guard.
  - Did NOT touch `org_optimizer_seed.ts` or anything that seeds/enables the
    #830 cron — verified no enable/pause toggle exists yet in this codebase,
    so the constraint was satisfied by not adding a call path to it.
- Deviations from spec: none against the 6 acceptance criteria. One
  environment fix bundled in (see Concerns) but backed out of the committed
  diff.
- Concerns:
  - The worktree's `apps/api_server/node_modules` was missing
    `better-sqlite3` at task start (empty node_modules with only `.bin` and
    `@esbuild`) — required `npm ci` to restore before any test could run.
    This is an environment issue, not a code issue; `package.json`/
    `package-lock.json` are unchanged in the final diff (reverted an
    accidental `^12.8.0` -> `^12.11.1` bump from an initial bare
    `npm install better-sqlite3`, then reinstalled via `npm ci` to pin back
    to the locked version).
  - `MIN_TIGHTEN_OBSERVATION_DAYS=7` / `MIN_TIGHTEN_ACTIVITY_COUNT=10` are
    reasonable conservative defaults but not derived from real usage data —
    worth revisiting once the optimizer has run live for a while under this
    guard.
  - The review-queue "revert" UI action (Flutter side) is NOT implemented —
    only the API route/controller. Flagged as a natural follow-up if the
    reviewer wants a button rather than calling the endpoint directly.
### 2026-07-02 — #814 pin/bundle rhythm MCP server version
- Files modified: `apps/api_server/src/services/opencode_client_service.ts`
  (new `resolveRhythmMcpCommand()` + `readRhythmMcpServerVersion()`;
  `ensureRhythmMcp()` now calls the resolver instead of hardcoding argv);
  `apps/api_server/src/__tests__/opc_rhythm_mcp_ensure.test.ts` (fixture now
  derives `DESIRED.command` from the resolver instead of the old bare spec);
  `apps/api_server/src/__tests__/opc_rhythm_mcp_command.test.ts` (new, 11
  tests); `.github/workflows/desktop_release.yml` (new bundling steps: build
  `apps/mcp_server`, copy `dist/+package.json/-lock+node_modules` into
  `Contents/Resources/mcp_server`, verify payload).
- Checks run: `tsc --noEmit` (api_server) — pass. `vitest run` full suite —
  215 files / 1855 pass / 1 pre-existing skip. `apps/mcp_server`: `npm run
  build` (tsc --noCheck) — pass. `desktop_release.yml` YAML parsed with
  `python3 -c "import yaml..."` — valid syntax (not run through actual CI in
  this session).
- Decisions made: bundle-with-pinned-fallback per issue recommendation; see
  `docs/ai/decisions/2026-07-02-pin-bundle-rhythm-mcp-version.md` for the full
  resolution order, alternatives, and follow-up risk note.
- Deviations from spec: none. Real-binary smoke (spawn + assert `tools/list`
  contains `rhythm_remember_memory`/`rhythm_list_sessions`) not run in this
  env; documented as a manual step in the new test file's trailing comment,
  backed by a source grep confirming both tools exist in
  `apps/mcp_server/src/tools/{agentMemory,agentSessions}.ts`.
- Concerns: the new `desktop_release.yml` bundling steps are untested by an
  actual CI run — flagged as a follow-up in the decision doc (low risk:
  mcp_server's only runtime deps, `@modelcontextprotocol/sdk` and `zod`, are
  pure JS with no native bindings, unlike `better-sqlite3` in api_server).

### 2026-07-02 — #856 reload provider credentials on auth change
- Files modified: `apps/api_server/src/services/auth_credential_watcher.ts`
  (new — pure `decideReload()` decision function + `AuthCredentialWatcher`
  class with injectable fs/timer deps); `apps/api_server/src/services/
  auth_credential_watcher.test.ts` (new, 11 tests); `apps/api_server/src/
  services/opencode_client_service.ts` (`EngineStatus` gained `'reloading'`;
  new `reloadCredentials()` method does dispose()+initialize() bounce;
  `statusMessage` surfaces `'Reloading credentials…'`; added
  `currentStatusForLogging()` helper to work around a TS narrowing quirk);
  `apps/api_server/src/services/opencode_client_service.test.ts` (new
  `describe('reloadCredentials (#856)')`, 5 tests); `apps/api_server/src/
  server.ts` (wires `AuthCredentialWatcher` watching `~/.local/share/
  opencode/auth.json`, started after `opencodeClient.initialize()` inside the
  `agentExecutionEnabled` block; stopped in the shutdown handler).
- Checks run: `tsc --noEmit` (api_server) — pass. `vitest run` full suite —
  216 files / 1871 pass / 1 pre-existing skip (up from 215/1855 after #814;
  16 new tests, no regressions).
- Decisions made: api_server-side fs.watch + debounce, NOT an in-engine/fork
  change (per the issue's lowest-risk guidance); a full dispose()+initialize()
  bounce rather than a partial re-`restoreAuth()`, because the issue's own
  diagnosis is that the SDK client/subprocess hold the stale token beyond
  what re-calling `setAuth`/`setOAuthCredentials` alone would override. See
  `docs/ai/decisions/2026-07-02-auth-credential-watcher-bounce.md` for full
  rationale, alternatives, and the desired UX message state
  (`statusMessage === 'Reloading credentials…'` while `status ===
  'reloading'`).
- Deviations from spec: none. No Flutter-side UI change made — the desktop
  client already polls the existing `statusMessage`/`isReady` surface, so it
  picks up the new message without further api_server work, but a follow-up
  should verify the client's UI treatment is prominent enough (noted in the
  decision doc).
- Concerns: no end-to-end test spawns a real opencode engine and rewrites a
  real `auth.json` — `initialize()`/`dispose()` are spied/mocked in the
  `reloadCredentials()` unit tests (the standard seam already used elsewhere
  in this file, since the real SDK spawn is a dynamic ESM import not
  exercised in the unit suite). A manual account-switch smoke is recommended
  before considering #856 fully closed.
### 2026-07-02 — #858 UUID-keyed agents can't chat (worktree: 858-ocagent)
- Files modified:
  - `apps/api_server/src/controllers/agent_sessions_controller.ts` — session-create
    and resume now persist `agentKind` = `agentConfig.ocAgent` (falling back to the
    config id only when `ocAgent` is empty), instead of the raw `agent_configs.id`.
    Resume additionally calls `repo.updateAgentKind()` when the resolved name
    differs from what's stored, so a pre-fix row self-heals on next resume.
  - `apps/api_server/src/services/agent_profile_sync.ts` — added a second pass
    after the engine-agents loop that backfills `oc_agent` to `id` for every
    enabled, projectable (`isProjectableAgentConfig`) row whose `oc_agent` is
    null/empty/stale. This is the only path that reaches UUID-keyed rows the
    engine has never reported via `listAgents()`.
  - `apps/api_server/src/services/opencode_agent_writer.ts` — extracted the pure
    eligibility check (`isProjectableAgentConfig`) out of `shouldWriteAgentFile`
    so the backfill pass can call it without the test/postgres env guards that
    gate the actual file-write side effect.
  - `apps/api_server/src/routes/agents_capabilities_routes.ts` — "custom agent
    config" capability now checks the config's resolved engine name against a
    live `opencodeClient.listAgents()` snapshot (fail-open to prior
    engine-ready-only behavior when the list is unavailable), so a UUID whose
    `ocAgent` isn't actually registered no longer reports as promptable.
  - Tests: `apps/api_server/src/__tests__/agent_sessions.test.ts`,
    `apps/api_server/src/services/__tests__/agent_profile_sync.test.ts`,
    `apps/api_server/src/__tests__/agents_capabilities_routes.test.ts` — new
    `#858` cases (create/resume engine-name resolution, backfill, capabilities
    gating) plus regression cases for slug-keyed configs.
  - `PATCH /agent-configs/:id` (item 4 of the issue) was found ALREADY
    implemented and tested on this branch (`agent_configs_controller.ts`
    `.patch()`, wired in `agent_configs_routes.ts`, covered by
    `agent_configs_routes.test.ts`) — no changes needed there.
- Checks run:
  - `tsc --noEmit` — clean.
  - `vitest run` targeted files (`agent_sessions.test.ts`,
    `agents_capabilities_routes.test.ts`, `agent_profile_sync.test.ts`,
    `agent_configs_routes.test.ts`) — 100/100 pass.
  - `vitest run` full suite — 214 files, 1858 passed, 1 skipped (pre-existing), 0 failed.
- Decisions made:
  - Root-caused the bug to `AgentSelectorPill`'s per-turn `agent` field and
    `ws_gateway.ts`'s `perTurnAgent ?? wsOcAgent` precedence: both ultimately
    resolve through `agent_configs.oc_agent`, so the real defect is `oc_agent`
    being null/wrong for UUID-keyed rows, not a missing resolution step at the
    WS layer (which was already correct). Fixed at the source: session-create/
    resume now always persist the resolved engine name into `agent_kind`, and
    sync guarantees `oc_agent` converges to `id` (the name
    `opencode_agent_writer` actually registers the row's file under) for every
    projectable row, closing the gap for rows the engine-agents loop never visits.
  - Backfill runs opportunistically on every `GET /agents/capabilities`-adjacent
    `GET /agents` call (which fires `syncOpencodeAgentProfiles`) and on
    `POST /agent-configs/sync-opencode` — no new cron/migration needed.
- Deviations from spec: none — all 4 acceptance items satisfied (item 4 was
  pre-existing).
- Concerns:
  - The backfill sets `oc_agent = id` for any not-yet-synced projectable UUID
    row. This is correct once `writeAgentProfileFile` + an engine reload
    complete the round-trip, but there's a narrow window (row saved, sync ran,
    engine hasn't reloaded the `.md` file yet) where `oc_agent` optimistically
    points at a name the engine doesn't recognize YET. `/agents/capabilities`'
    live-name check (item 3) correctly reports `false` during that window, so
    the UI won't offer a broken chat — but a `session.input` frame sent to an
    already-open picker selection made just before the reload could still hit
    "Agent not found" once. Not addressed here (out of scope — no reload-wait
    mechanism existed before this fix either); flagging for a possible
    follow-up if it recurs in practice.
### 2026-07-02 — issue #861 (Task card delegation navigation, worktree `861-taskcard` / branch `issue-861-task-card-nav`)
- Files modified:
  - `apps/api_server/src/controllers/agent_sessions_controller.ts` — `getChildren`
    and `getChildMessages` no longer 404 when `:id` has no local DB row; child
    sessions never have one by design, so absence is now treated as "`:id` is
    itself a child/grandchild SDK session id" and the SDK call proceeds
    directly. This was the backend blocker for nested (grandchild+) delegation.
  - `apps/api_server/src/__tests__/opc_m3_6_child_sessions.test.ts` — replaced
    the two `unknown-session → 404` assertions (no longer the contract) with
    nested-lookup tests (`issue-861-c1a-nested*`, `issue-861-c1b-nested`).
  - `apps/desktop_flutter/lib/features/agents/controllers/agents_controller.dart`
    — `AgentsController`'s child-session navigation state changed from a
    single slot (`_activeChildSessionId` etc.) to a `List<_ChildFrame>` stack,
    so `closeChildSession()` pops one hop instead of always returning to the
    top-level parent. Added `activeChildDisplayName` and `childStackDepth`;
    `openChildSession` gained an optional `childDisplayName` param.
  - `apps/desktop_flutter/lib/features/agents/views/_tool_renderers/_task_chip.dart`
    — passes its own description as `childDisplayName` on tap.
  - `apps/desktop_flutter/lib/features/agents/views/agents_view.dart` —
    `ChildTranscriptView` gained an `ownDisplayName` field and now renders any
    `task` tool parts in a child message as nested, tappable `TaskChip`s
    (previously collapsed to a `⚙ task` text summary, so grandchild delegation
    was never clickable at all).
  - `apps/desktop_flutter/test/features/agents/issue_861_nested_task_card_nav_test.dart`
    (new) — mounted-surface tests pumping the real `AgentsView` (not an
    isolated widget), covering: tapping a top-level Task card opens the child
    in the real chat pane; a nested Task card inside that child opens a
    grandchild with the breadcrumb correctly pointing at the intermediate
    child (not the top-level parent); back navigation pops one hop at a time;
    an unresolvable child id renders a disabled/non-clickable card.
- Checks run:
  - `cd apps/api_server && node_modules/.bin/tsc --noEmit` — pass, no errors.
  - `cd apps/api_server && node_modules/.bin/vitest run src/__tests__` — 178
    files / 1542 passed / 1 pre-existing skip.
  - `cd apps/desktop_flutter && flutter analyze --no-fatal-infos` — 267
    pre-existing info-level lints, 0 errors, no new issues vs baseline.
  - `cd apps/desktop_flutter && flutter test test/features/agents/` — 473
    tests, all passed (includes the new mounted-surface nested-delegation
    tests and the pre-existing `opc_m3_6_child_sessions_test.dart` unchanged).
  - `cd apps/desktop_flutter && dart format . --set-exit-if-changed` — clean
    (0 files changed on the final run; two files were auto-formatted once and
    re-verified).
- Decisions made:
  - Single-hop child navigation (#699 / OPC-M3-6, already on `main`) covered
    top-level Task-card → child transcript + breadcrumb-back + disabled state,
    but nested delegation (parent → orchestrator → specialist) was NOT
    implemented: the controller only tracked one active child, and
    `ChildTranscriptView` rendered nested `task` tool parts as inert text, so
    a grandchild's card was never even shown, let alone tappable. Backend
    `getChildren`/`getChildMessages` additionally 404'd on any id without a
    local DB row, which is exactly what a child's own SDK id looks like. This
    run closes that specific gap rather than re-doing #699's already-shipped
    single-hop path.
  - Chose a navigation STACK (`List<_ChildFrame>`) over recursively nesting
    widgets, so `closeChildSession()` naturally pops one level and the
    existing single-slot public getters (`activeChildSessionId`,
    `activeChildParentName`) keep their pre-#861 meaning for one-hop callers
    (top of stack / that frame's breadcrumb target).
  - Backend fix relaxes rather than removes the 404: when `:id` DOES resolve
    to a local row, existing single-hop behavior (mapped SDK id, empty array
    on no active mapping) is unchanged. Only the "no local row" branch changed
    from "404" to "treat as a raw SDK id and ask the SDK" — the SDK's own
    404/502 on a genuinely bad id still surfaces via `next(err)`.
- Deviations from spec: none — nested delegation, per-hop breadcrumb, and
  disabled/unresolvable-card behavior all match the issue's acceptance
  criteria.
- Concerns:
  - `AgentsController.selectSession()` does not reset the child-navigation
    stack when switching to a different top-level session. This is pre-#861
    behavior (unchanged by this run) — flagged here in case a future session
    switch while a child view is open surfaces a stale child transcript.
  - The grandchild fixture ids in the new test had to avoid underscores
    after the `ses_` prefix, matching a real constraint in
    `_task_chip.dart`'s `task_id: ses_[A-Za-z0-9]+` output-parsing regex
    (it truncates at the first non-alphanumeric character). Real opencode
    ids never contain underscores, so this is not a product bug, but it is
    a sharp edge for anyone hand-writing future fixtures.
---

> Note: this worktree branches directly off `main`. Earlier snapshot
> content describing the separate `codex/mega-2026-07-02` integration
> branch (#848 and related) lives on that branch's own history — it was
> not this branch's context and has been removed from this file to keep
> it an accurate snapshot for `issue-863-quick-actions`. See
> `docs/ai/runs/2026-07-02-mega-buildout-fork-eval-memory.md` for that
> work if needed.
