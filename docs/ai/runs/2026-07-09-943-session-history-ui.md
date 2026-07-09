---
date: 2026-07-09
repo: Rhythm
branch: wt/943-bg-sessions-ui
pr: null
issues: [943]
status: verification-blocked
tags: [run, Rhythm]
---

# Run: #943 Session History UI

## Files

- `apps/desktop_flutter/lib/features/session_history/` — new Flutter feature with models, HTTP data source, repository, ChangeNotifier controller, list view, and read-only transcript view.
- `apps/desktop_flutter/lib/main.dart` — registered `SessionHistoryController` in the existing `MultiProvider`.
- `apps/desktop_flutter/lib/app/core/constants/app_constants.dart` — appended `navSessionHistory = 10`.
- `apps/desktop_flutter/lib/app/core/layout/navigation_sidebar.dart` — appended the `Session History` sidebar item.
- `apps/desktop_flutter/lib/app/core/layout/app_shell.dart` — registered `SessionHistoryView` in the existing view list.

## Backend Contract Confirmed

- `GET /agent-sessions`
  - Response: `{ sessions: AgentSession[], resumable: AgentSession[] }`.
  - Used for cookbook/headless `AgentRunner run` rows. Normal list excludes `is_system = 1`.
- `GET /agent-sessions?scheduledTaskId=<id>`
  - Response: `{ sessions: AgentSession[], resumable: AgentSession[] }`.
  - Used for scheduled-task runs; backend intentionally exposes these system rows through this query branch.
- `GET /agent-sessions/:id/messages`
  - Response: `{ messages: AgentSessionMessage[] }` from local message rows ordered by creation.
- `GET /agent-schedules`
  - Response: `AgentScheduledTask[]`.
  - Used only to discover scheduled task IDs/names before calling the existing agent-session filtered listing.

All agent traffic uses `AppConstants.agentLocalBaseUrl` (`http://localhost:4001`), not `serverConfigService.url`.

## Checks

- `HOME=/private/tmp DART_SUPPRESS_ANALYTICS=true dart format <session_history files>` — pass; `Formatted 6 files (0 changed)`.
- `git diff --check` — pass; no whitespace errors.
- `dart analyze lib/features/session_history/models` — pass; `No issues found!`.
- `dart format .` — blocked by sandbox: Flutter SDK wrapper attempted to write `/Users/ajhochhalter/development/flutter/bin/cache/engine.stamp`.
- `flutter analyze --no-fatal-infos` — blocked by the same SDK-cache write before analysis started.
- `dart pub get` — blocked by restricted network: socket error fetching `flutter_lints` from `https://pub.dev`.
- Direct `dart analyze` fallback — inconclusive because `.dart_tool/package_config.json` is absent, so Flutter/provider/http package imports cannot resolve.

## Notes

- GitNexus MCP/local runner was unavailable in this worktree (`tool_search` exposed no GitNexus tools and `.gitnexus/run.cjs` is absent). Scope was checked with direct symbol/caller search and `git diff --name-status`.
- No backend files were changed.
- No visual smoke was run; the Flutter wrapper cannot launch/analyze in this sandbox due the SDK-cache write blocker. Human visual smoke is still required per the issue.
