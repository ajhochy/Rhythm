---
date: 2026-07-03
repo: Rhythm
branch: workflow/run-2026-07-03
pr: []
issues: [888]
status: verification-gate PASSED, not yet folded/committed
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# 2026-07-03 — Issue #888: quick-action buttons spawn Coding Workflow instead of Secretary

## Root cause (confirmed, matched dispatch triage exactly)

The task quick-action buttons (Help me finish / Draft next steps / Summarize /
Create follow-up tasks) passed `mcpRole: 'secretary'` — which only scopes the
MCP tool allowlist — but never passed `agentId`. The server resolves which
engine agent actually **runs** a session solely from `agentId`
(`apps/api_server/src/controllers/agent_sessions_controller.ts` ~421-433;
`mcpRole` handled independently ~473-503). With `agentId` omitted,
`AgentsController.createSession` fell back to
`_resolveDefaultAgentIdForCreate()` → the first authorized catalog entry
("Coding Workflow"), so Secretary never ran and #883's delegation never fired.

## Files changed (Flutter-only per dispatch ownership split; backend half owned by a concurrent agent)

- `apps/desktop_flutter/lib/features/agents/views/quick_actions_bar.dart` —
  both `createSession(...)` call sites (`_runChatAction`,
  `_runCreateFollowUpTasks`) now also pass
  `agentId: context.read<AgentConfigsController>().managerAgent?.ocAgent ??
  'secretary'`, resolving the Secretary profile's engine agent dynamically
  rather than hardcoding it, with a fallback for the unseeded case.
- `apps/desktop_flutter/test/features/agents/quick_actions_bar_test.dart` —
  added `lastAgentId` capture to `_StubAgentsRepository.createSession`; added
  `_FakeAgentConfigsController` (subclasses the real controller, overrides
  `managerAgent` to return a Secretary profile with `ocAgent: 'secretary'`,
  backed by a no-op `AgentConfigsDataSource` stub so no network call is ever
  made); wired it into `_buildApp`'s `MultiProvider` at all 7 call sites;
  added `expect(stubAgentsRepo.lastAgentId, equals('secretary'))` to the
  "Help me finish this", "Draft next steps", "Summarize", and "Create
  follow-up tasks" cases.

## Checks run

- `dart format .` (full repo) — 378 files, 0 changed.
- `flutter analyze --no-fatal-infos` (full repo) — 0 errors; 266 pre-existing
  info-level `prefer_const_*` hints, none new.
- `flutter test` (full repo) — **793 pass, 0 fail**.
- Fails-before/passes-after proof: stashed only the lib fix (kept the
  strengthened test), reran → **4 of 7 tests failed** with
  `Expected: 'secretary' / Actual: <null>` on Help me finish this, Draft next
  steps, Summarize, and Create follow-up tasks; restored the fix, reran →
  7/7 pass.
- `verification-gate`: PASS (full-repo `ai-workflow checks --level pr` was
  intentionally not run — `apps/api_server` has a concurrent sibling agent's
  in-flight, uncommitted edits for the backend half of this same issue;
  running the full-repo PR-level check would have produced misleading
  evidence for code this agent does not own. Flutter-scoped static + full
  test suite is complete coverage for the changed files.)

## Notes / decisions

- No screenshot required — this is a data-flow fix (new `agentId:` argument
  to an existing `createSession()` call), zero layout/widget/styling changes.
  Confirmed via the unchanged full widget-test suite passing.
- Confirmed `AgentConfigsController` is a top-level `ChangeNotifierProvider`
  in `main.dart` (created before `AgentsController`, per the existing #745
  comment there), and both real `QuickActionsBar(` mount sites
  (`app/core/ui/rhythm_inspector.dart:801`,
  `features/dashboard/views/dashboard_view.dart:1117`) render beneath that
  provider tree — no missing-provider risk found.
- Not yet committed (per dispatch instructions) — working tree still has the
  two Flutter files modified plus a concurrent sibling agent's in-flight
  `apps/api_server` changes (`server.ts`, `auth_credential_watcher.ts/.test.ts`)
  for the backend half of #888, untouched by this run.
- Follow-up: once the backend half lands, a live end-to-end smoke (tap a
  quick-action button in the running app, confirm the created session's
  bound agent is Secretary, not Coding Workflow) would close the loop that
  unit tests alone can't fully prove (session→engine-agent binding is
  ultimately a server-side resolution).
