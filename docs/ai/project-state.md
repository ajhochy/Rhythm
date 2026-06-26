# Project State

## Current focus

**2026-06-25 — Issue #746: agent session startup latency reduction.**

Branch `workflow/run-2026-06-25-agent-fixes` — all four items implemented and verified:

1. **Phase timing logs** — `[Opencode][timing] <phase> took Nms` in `_initializeImpl()` (6 phases) and `create()` (3 phases).
2. **Eager engine warm** — `notifyEngineReady()` called from `server.ts` `.then()` block; curator cold window starts exactly when engine is ready.
3. **Non-blocking composer** — `_EngineConnectingState` widget renders immediately when `controller.isCreating == true`; disabled composer + "Connecting…" banner.
4. **Curator throttle** — `queueSkillExtraction` defers for 90s after engine init.

Previous work on this branch: #747 (background activity indicator), #743 (child session persistence + getDiff flood fix), #745 (manager-default AgentSelectorPill), #742 (Secretary routing depth).

## Active branch / PR

- **Branch:** `workflow/run-2026-06-25-agent-fixes`
- **PR:** not yet opened — next step is draft PR covering all issues on this branch.
- **Related open PR:** [#734](https://github.com/ajhochy/Rhythm/pull/734) — mcp-scope work, do not merge.

## In progress

All issues on branch (#742, #743, #745, #747, #746) implemented and verified. Awaiting draft PR open + manual smoke.

Key changes on this branch (cumulative):

**#746 (current):**
- `notifyEngineReady()` + `isCuratorThrottled()` in `skill_extractor.ts`
- `_engineReadyAt` getter on `OpencodeClientService`
- `[Opencode][timing]` phase logs in `_initializeImpl()` + `create()`
- `_EngineConnectingState` widget in `agents_view.dart`
- 6 new TS tests + 5 new Dart widget tests

**#747:**
- `BackgroundActivityController` + `/background-status` endpoint
- `is_system` column for scheduler sessions
- `BackgroundActivityIndicator` in app shell header

**#743:**
- Child session persistence via `session.created` SSE events
- `parent_session_id` column (SQLite + Postgres)
- `getDiff` soft-404 (200 [] for unknown session ids)
- `AgentSession.parentId` + `_buildSessionTree()` in Flutter

**#745 / #742:**
- `AgentSelectorPill` defaults to manager profile
- `MAX_DELEGATION_DEPTH` raised 1→2
- Secretary routing rule updated

## Risks / known issues

- **Visual smoke required for #746** — `_EngineConnectingState` banner/disabled composer must be confirmed in `flutter run` (transient state during ~30s cold-start; cannot screenshot without live app).
- **MCP cold-start cost unknown** — timing logs will reveal if `createOpencode` phase dominates. Follow-up issue for lazy-MCP init if > 10s observed in production logs.
- **Pre-existing flaky test:** `claude_triggers.test.ts > repeated add/remove/add` — non-deterministic test-order isolation failure, unrelated to this branch.
- **Secretary prompt picked up on next session only** — updated `secretary.md` read at session creation; existing sessions need reopening.
- **Issue 06 live smoke still required** (mcp-scope) — CI binary bundle not yet exercised in a real release run.

## Test status

| Suite | Status |
|-------|--------|
| `dart format --set-exit-if-changed` | **PASS** — 0 changed |
| `flutter analyze --no-fatal-infos` | **PASS** — 0 errors, 0 warnings (259 pre-existing infos) |
| `flutter test` | **PASS** — 693/693 (5 new #746 widget tests) |
| `apps/api_server npx tsc --noEmit` | **PASS** — exit 0 |
| `apps/api_server vitest` | **PASS** — 1250/1250 (6 new #746 latency tests) |

## Next step

1. Open draft PR for `workflow/run-2026-06-25-agent-fixes` covering #742 + #743 + #745 + #747 + #746 (with `Closes #N` for each).
2. Manual smoke:
   - `flutter run`, open a new agent session, confirm "Connecting to agent engine…" banner + disabled composer appear during cold-start window (#746).
   - Confirm background activity indicator shows spinning states during scheduler/sync activity (#747).
   - Confirm child sessions appear indented under parent after `task` delegation (#743).
   - Confirm pill shows manager label (#745).
   - Confirm getDiff no longer floods ERROR logs (#743).
3. After smoke passes, merge (human sign-off required).

Run logs:
- `docs/ai/runs/2026-06-25-issue-746-startup-latency.md`
- `docs/ai/runs/2026-06-25-issue-743-child-session-persistence.md`

Decisions:
- `docs/ai/decisions/2026-06-25-issue-746-notifyengineready-wiring.md`
- `docs/ai/decisions/2026-06-25-issue-743-logger-debug.md`
- `docs/ai/decisions/2026-06-25-issue-747-is-system-column.md`

---

## Recent coding-agent runs

### 2026-06-25 — Issue #746: agent session startup latency reduction

- **Files modified:** `opencode_client_service.ts` (timing + engineReadyAt), `agent_sessions_controller.ts` (timing), `skill_extractor.ts` (curator throttle), `server.ts` (notifyEngineReady wiring), `agents_view.dart` (_EngineConnectingState + test harness), + 2 new test files
- **Checks run:** tsc, dart format, flutter analyze, vitest 1250/1250, flutter test 693/693 — all PASS
- **Decisions made:** notifyEngineReady wired from server.ts (not service) to avoid circular import — see `docs/ai/decisions/2026-06-25-issue-746-notifyengineready-wiring.md`
- **Deviations from spec:** none
- **Concerns:** MCP cold-start cost unquantified until timing logs run in production; visual screenshot requires manual smoke

### 2026-06-25 — Issue #747: background activity indicator

- **Files modified:** `skill_extractor.ts`, `skill_refiner.ts`, `sync_orchestrator_service.ts`, `migrations.ts`, `postgres_bootstrap.ts`, `agent_session.ts`, `agent_sessions_repository.ts`, `agent_runner.ts`, `agent_sessions_controller.ts`, `agent_sessions_routes.ts`, + 5 new Flutter files + 1 new test file
- **Checks run:** flutter analyze PASS, dart format PASS, tsc PASS, vitest 1244/1244 PASS, flutter test 688/688 PASS
- **Decisions made:** `is_system` boolean column for scheduler session tagging — see `docs/ai/decisions/2026-06-25-issue-747-is-system-column.md`
- **Deviations from spec:** none
- **Concerns:** Skill-extract/refine sessions not in local `agent_sessions` (no parentID), status tracked in-memory only

### 2026-06-25 — Issues #743 + #745 + #742

- **Files modified:** session persistence, getDiff, SDK d.ts fix, AgentSelectorPill, MAX_DELEGATION_DEPTH, Secretary prompt
- **Checks run:** All PASS (676/676 flutter, 1232/1232 vitest)
- **Decisions made:** `logger.debug` unavailable — info level used — see `docs/ai/decisions/2026-06-25-issue-743-logger-debug.md`
- **Deviations from spec:** none
- **Concerns:** Visual smoke gap for AgentSelectorPill label/color
