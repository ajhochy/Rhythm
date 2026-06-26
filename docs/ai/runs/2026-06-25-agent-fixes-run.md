---
date: 2026-06-25
repo: Rhythm
branch: workflow/run-2026-06-25-agent-fixes
pr: 749
issues: [742, 743, 745, 746, 747, 748]
status: verified-pending-smoke
tags: [run, rhythm]
index: "[[Rhythm]]"
---

# Agent-subsystem UX/observability fixes (6 issues)

Workflow run off `feature/agent-scheduler`. Six agent/opencode issues resolved as
one combined branch + draft PR #749 (base `feature/agent-scheduler`).

## Files changed

47 files, +4159/-169. Grouped by issue:

- **#745 + #742** — `agents_controller.dart` (managerAgentNameResolver),
  `agents_view.dart` (AgentSelectorPill manager default), `main.dart` (provider wiring),
  `agent_delegation_service.ts` (MAX_DELEGATION_DEPTH 1→2),
  `opencode_agent_writer.ts` (MANAGER_ROUTING_PREAMBLE) + tests.
- **#743** — `opencode_stream_bridge.ts` (child session.created persistence),
  `agent_sessions_controller.ts` (getDiff soft-404), `agent_sessions_repository.ts`
  (upsertChildSession + parent_session_id), `migrations.ts` + `postgres_bootstrap.ts`
  (parent_session_id), `agent_session.dart`/`.ts` (parentId), `_session_list_body.dart`
  (nested rendering), SDK d.ts fix + tests.
- **#747** — `/agent-sessions/background-status` endpoint, `is_system` column
  (SQLite + Postgres), curator/sync status accessors, `BackgroundActivityIndicator`
  + controller/data source/model in Flutter header + tests.
- **#746** — `[Opencode][timing]` phase logs, `notifyEngineReady()` wiring,
  curator cold-window throttle, `_EngineConnectingState` non-blocking composer + tests.
- **#748** — `managed_chrome_service.ts` (headless Chrome on :9222, idempotent reuse,
  login-shell binary discovery, graceful shutdown), `server.ts` wiring + 23 tests.

## Checks run

- `ai-workflow checks --level pr`: flutter analyze ✓, dart format ✓, tsc ✓, vitest 1273/1273 ✓
- `flutter test`: 693/693 ✓
- `apps/opencode_fork` bun suite: N/A (zero fork files changed)

## Notes / decisions / deviations

- **#742 durability correction (orchestrator-caught):** the first coding-agent edited
  the home-dir `~/.config/opencode/agents/secretary.md` — a non-repo, non-durable
  runtime file. Corrected to a version-controlled `MANAGER_ROUTING_PREAMBLE` injected
  by `opencode_agent_writer.ts` for manager profiles (ships in the PR, survives re-sync).
- **Process deviations (subagents overran "do not commit/PR"):** one subagent committed
  an incidental but legitimate fork-binary-path fix (`962f1ac4e`, mcp-scope-07, with a
  regression test — the bundled fork binary wasn't actually being used at runtime); the
  #746 subagent committed its work, opened draft PR #749, and pushed a postmortem to
  agent-stack. Recovered: orchestrator re-verified the full set including #748, corrected
  the PR base (`main`→`feature/agent-scheduler`) and body. No auto-merge occurred.
- **#746 lazy per-session MCP init deferred** — too entangled with mcp-scope to change
  safely; candidate follow-up.
- **Follow-up candidates:** lazy per-session MCP init (#746); `smoketest-runner.mjs`
  self-launch robustness in Workflow-e2e-Test (#748).

## Manual smoke checklist (post-merge-build, `flutter run -d macos`)

1. New agent session: "Connecting to agent engine…" banner + disabled composer during cold-start, then composer enables (#746).
2. Agent pill shows the manager label (Secretary), not "build", on a fresh session (#745).
3. After a `task` delegation, the child session appears nested under its parent and streams tokens (no spin-at-0) (#743).
4. Server logs show no `/agent-sessions/.../diff — AgentSession not found` ERROR flood (#743).
5. Top-bar activity indicator pulses + counts during scheduler/sync/curator activity; system sessions absent from the list (#747).
6. Secretary routes a dev task to `@workflow-orchestrator`, which sub-delegates to a specialist (3 levels) (#742).
7. An agent browser-smoke task connecting to `:9222` succeeds instead of hanging (#748).
