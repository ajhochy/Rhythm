# Project State

## Current focus

Open-PR merge train complete. All previously-open PRs are merged into `main`;
zero open PRs remain.

## Active branch / PR

- Branch: `main` at `4259320f5` (post-merge).
- No open PRs.

## In progress

- Nothing. The 9-PR backlog from the 2026-07-16 Codex handoff is fully landed.

## Recently merged (2026-07-16)

- #1104 (#1038 dark-theme Projects) and #1106 (#1082 skill-revert byte-safe) — merged by the prior Codex session.
- #1100 (#1091 gemini anyOf sole-key), #1101 (#1089 cron timezone), #1102 (#1083 NULL MCP scope insert-only),
  #1103 (codex gpt-5.6-sol route), #1095 (#1093 hybrid Engraph memory retrieval),
  #1105 (#1001 live-E2E isolation guard), #1107 (#1041 prompt-fix resolver fallback) — this session.
- Each remaining PR was rebuilt as a single clean commit on current `main`, dropping the shared
  pre-squash #1097 noise that would otherwise have reverted `project-state.md` and re-added divergent
  manager-routing files on squash-merge.

## Risks / known issues

- #1100's fix lives in `apps/opencode_fork` (no fork CI in this repo). Source fix is unit-tested
  (bun test 12/12); the shipping app uses a pre-built fork binary, so a release build must rebuild
  the fork to pick it up.
- Codex's speculative hardening (allowed_mcps_state provenance column, path confinement) was
  deliberately NOT adopted — Codex itself flagged it HIGH blast radius; the PRs' own targeted fixes
  are sufficient and covered by tests.

## Test status

- Final merged `main`: `npm run build` clean, full unit suite 2769 passed / 32 skipped, 0 failures
  (baseline was 2728; +41 from the merged PRs' tests).
- Release smoke (`apps/api_server/scripts/smoke-launch.sh`) on merged `main`: PASS — build + spawn +
  bind :4001 + /health + /agents/capabilities 200 + POST /agent-sessions 201, isolated temp DB.
- All 6 api_server PRs passed `server-checks` CI on their pushed SHAs; #1100 validated locally (no fork CI).

## Next step

Trigger a desktop release build (increment patch from latest tag) when ready to ship; the release
build rebuilds the bundled Node server and the opencode fork binary (needed for #1100 to take effect).

## Recent coding-agent runs

### 2026-07-16 — #1090 (Cluster E) background sessions leak into "chats"

- Files modified:
  - `apps/desktop_flutter/lib/features/agents/controllers/agents_controller.dart` — added
    shared `_belongsToScope(session, scope)` predicate; gated both `_onWsMessage` live-insert
    branches (`SessionCreatedMessage`, `SessionUpdatedMessage`'s active sub-branch) so a
    background/scheduled/self_improvement session broadcast on the shared WS channel is only
    admitted into `_sessions` when it matches the currently-viewed `AgentSessionScope`.
  - `apps/desktop_flutter/lib/features/agents/models/agent_session.dart` — **scope deviation**
    (see Decisions below): added `isSystem` (bool, default false) and `category` (String,
    default 'chat') fields, `fromJson` parsing, and `copyWith` preservation. Required because
    the predicate above cannot exist without these two fields, which the model did not parse
    before this change.
  - `apps/desktop_flutter/test/features/agents/agents_controller_test.dart` — 6 new tests
    (TDD red→green) covering: create/update exclusion of a self_improvement session from
    chats scope, an interactive chat session still appearing immediately, a scheduled session
    being admitted when scope=scheduled, and "no refresh-only divergence" (WS-filtered set
    matches a simulated reload from a correctly-scoped fixture).
  - `apps/desktop_flutter/test/features/agents/agent_session_test.dart` — 3 new tests for the
    new model fields (`fromJson` defaults, `fromJson` parsing, `copyWith` preservation).
- Checks run:
  - `flutter test test/features/agents/agent_session_test.dart` — pass (10/10, incl. 3 new).
  - `flutter test test/features/agents/agents_controller_test.dart` — pass (48/48, incl. 6 new).
  - `flutter test test/features/agents/agents_nav_column_mounted_test.dart` — pass (20/20,
    unaffected — confirms leaving `load()`/full-load untouched was correct; see Decisions).
  - `flutter test` (full suite) — pass, 872/872, exit 0.
  - `dart format . --set-exit-if-changed` — clean, 0 files changed.
  - `flutter analyze --no-fatal-infos` — exit 0; 272 issues, byte-identical to the pre-change
    baseline (diffed) — zero new analyzer findings introduced.
  - `mcp__gitnexus__detect_changes` (unstaged, this worktree) — risk_level "low", 0 affected
    processes, 6 changed symbols / 4 files (matches the diff exactly).
- Decisions made (see `docs/ai/decisions/2026-07-16-1090-scope-touches-agent-session-model.md`):
  - Widened file ownership from "agents_controller.dart only" to also include
    `agent_session.dart` (+ its existing test). The plan's diagnosis said the WS payload
    "already carries `isSystem` + `category`" — true of the wire JSON, but the Flutter
    `AgentSession` model never parsed those two fields into accessible properties, so the
    predicate literally could not be written without this addition. No other cluster in
    `docs/ai/current-plan.md` touches this file. Purely additive (new optional fields,
    defaulted); verified safe via the full 872/872 green suite plus a byte-identical
    `flutter analyze` diff.
  - Did NOT add scope-filtering to `load()` (the full-load path). Two existing tests in
    `agents_nav_column_mounted_test.dart` (`#1025 scope dropdown switches scope and reloads`,
    lines ~900-948) exercise `loadSessions(scheduled)`/`loadSessions(selfImprovement)` against
    fixtures built with a local `_makeSession` helper that defaults `category` to `'chat'`;
    adding a client-side filter to `load()` would silently break those (out of my file
    ownership to fix). This is consistent with the existing design: full-load already trusts
    the server's `?scope=` filtering entirely; only the live WS path (shared across all
    scopes) needed a client-side mirror of that rule.
  - Left the `isArchived` / `status==resumable` sub-branches of the `SessionUpdatedMessage`
    handler unguarded. The plan's cited root-cause line numbers and the acceptance criteria
    both name only the `_sessions` ("chats") list; guarding the other two sub-branches would
    be a defensible but unrequested extension. Noted as a small residual risk below.
- Deviations from spec: the `agent_session.dart` file-ownership widening above. Everything
  else matches the assignment exactly (predicate name/shape, both `_onWsMessage` branches,
  TDD, gates).
- Concerns / residual risk (LOW):
  - `AgentSession` (the model file) is GitNexus-HIGH risk by raw fan-in (43 impacted symbols,
    23 direct callers) since it's a widely-referenced class — flagging per the repo's
    "MUST warn on HIGH/CRITICAL impact" rule. The specific edit is additive-only (2 optional
    fields, existing defaults preserve prior behavior for every call site); the full test
    suite and an identical `flutter analyze` diff back this up empirically.
  - If a background session ever transitions to archived/resumable while its category last
    matched the currently-viewed scope, it could still surface in `_archived`/`_resumable`
    outside that guard — pre-existing gap, not tightened by this fix (see above).
