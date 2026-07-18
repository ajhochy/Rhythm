---
date: 2026-07-17
repo: rhythm
branch: fix/1119-session-profile-persist-restart
pr: null
issues: [1119]
status: implemented-pending-verification-gate
tags: [run, rhythm]
---

## Summary

Root cause: **write gap only** (the read/restore path already existed and needed no change).

The Flutter agent-selector pill (`AgentSelectorPill` in `agents_view.dart`,
wired through `AgentsController.setSelectedAgent`) is the "switch profile"
UI for an existing session. It only ever wrote the chosen profile into an
**in-memory** map (`_selectedAgentBySession`) and forwarded it **per-turn**
on the WS `session.input` frame (`ws_gateway.ts` — deliberately "never
persisted" per the OPC-M4-4 design comment). `PATCH /agent-sessions/:id`
(`AgentSessionsController.update`) had **no `agentId` handler at all** —
so an explicit mid-session profile switch was never written to
`agent_sessions.agent_kind`. On a real app restart the in-memory map and
the WS session map are both wiped, so the client's rehydrate step read the
session row's **original** `agent_kind` (whatever it was created with,
typically the default/Secretary) — reproducing the reported bug exactly.

The read side was NOT broken: `AgentsController.selectedAgentFor()` already
falls back (resolution step 2, `#867`) to `AgentSession.agentId` — sourced
from the server's `agent_kind` column — whenever no in-memory override is
present. Once the column is actually written on switch, restart-restore
"just works" through this existing fallback; no read-path change was
needed.

## Files changed

- `apps/api_server/src/controllers/agent_sessions_controller.ts` — `update()`
  (PATCH `/agent-sessions/:id`) now accepts `agentId` and persists it via
  the existing `repo.updateAgentKind()` helper (already used by `resume()`).
  Non-empty string only; omitted/empty is a no-op (default behavior
  unchanged); non-string/non-null is a 400.
- `apps/desktop_flutter/lib/features/agents/data/agents_data_source.dart` —
  `updateSession()` gains an optional `agentId` param → `PATCH` payload.
- `apps/desktop_flutter/lib/features/agents/repositories/agents_repository.dart` —
  forwards the new `agentId` param.
- `apps/desktop_flutter/lib/features/agents/controllers/agents_controller.dart` —
  `setSelectedAgent()` now also fires `_persistSelectedAgent()` (new private
  method) to `PATCH` the session when a real (non-null) selection is made.
  Fire-and-forget / non-fatal on failure — the in-memory selection still
  drives the current run either way. The null/"reset to default" branch is
  unchanged (still local-only — see Known limitation below).
- **Test-double signature updates only** (adding the new optional
  `agentId`/`agentId:` param to `implements AgentsRepository` overrides so
  they keep compiling): `integration_test/follow_up_smoke_test.dart`,
  `test/features/agents/agent_trigger_watcher_test.dart`,
  `test/features/agents/agents_controller_test.dart`,
  `test/features/agents/agents_nav_column_mounted_test.dart`,
  `test/features/agents/issue_626_chip_status_flip_test.dart`,
  `test/features/agents/new_session_dialog_error_test.dart`,
  `test/features/agents/opc_713_create_loading_test.dart` (two declarations
  — the stub + the delegating wrapper).
- **New**: `apps/api_server/src/__tests__/issue_1119_session_profile_persist_restart.test.ts`
  — behavioral test (real Express router + real repository + real
  in-memory SQLite, no mocks on the code under test).

## Checks run

- `cd apps/api_server && npx tsc --noEmit -p tsconfig.json` → clean.
- `npx vitest run src/__tests__/issue_1119_session_profile_persist_restart.test.ts`
  → **5/5 passed**. Covers: (1) PATCH agentId persists to the row, (2)
  BEHAVIORAL — a fresh `AgentSessionsRepository` instance (models a restart,
  no shared in-process cache) plus a real `GET /agent-sessions/:id` HTTP
  call both read back the persisted profile, not the default, (3) a PATCH
  that never mentions `agentId` leaves the stored profile untouched
  (acceptance criterion 3), (4) non-string `agentId` → 400, row untouched,
  (5) empty-string `agentId` is a no-op.
- `npx vitest run src/__tests__/anthropic_session_routing.test.ts
  src/__tests__/issue_1119_session_profile_persist_restart.test.ts` → 20/20.
- `npx vitest run` (10 files touching `AgentSessionsController`/router incl.
  `opc_agent_session_routes`, `issue_653_contract`, `issue_850_contract`,
  `issue_638_contract`, `opc_m3_5_todo_panel`, `opc_m3_6_child_sessions`,
  `opc_m3_2_revert_unrevert`, `opc_m4_2_session_fork`, `opc_m3_3_compaction`,
  `opc_m3_1_changes_tab_diff`) → 58/58.
- `npx vitest run src/repositories/agent_sessions_repository.test.ts` →
  20/20.
- **Full api_server suite**: `npx vitest run` (whole repo) → **3006 passed
  / 18 failed / 38 skipped**. All 18 failures are the pre-existing
  `memory_*` vault-filesystem-pollution failures already documented in
  `docs/ai/project-state.md` (baseline was 3001 passed / 18 pre-existing
  fail before this branch's 5 new tests: 3001 + 5 = 3006). Zero
  branch-caused failures. (One earlier full-suite run also flagged
  `opencode_skills_visibility.test.ts` — confirmed a pre-existing
  parallelism flake, not a regression: passed 6/6 both standalone and on
  the clean rerun.)
- `dart format <12 changed files> --set-exit-if-changed` → 0 changed,
  clean.
- `flutter analyze --no-fatal-infos <12 changed files>` → 0 errors. 2
  pre-existing `info`-level lints on unrelated lines in
  `agents_nav_column_mounted_test.dart` / `opc_instant_new_session_test.dart`
  (both files touched by only a 1-line additive diff each — confirmed via
  `git diff --stat`, not introduced by this change).
- `flutter test` on the directly-affected + regression-relevant surfaces
  (`opc_m4_4_agent_selection_test.dart`, `issue_867_session_agent_binding_test.dart`
  — the two suites that assert the pill/selection-resolution contract this
  fix touches — plus the 7 files whose test-double signatures changed) →
  **108/108 passed**.
- GitNexus `impact()` run before editing `updateAgentKind`, `update`,
  `setSelectedAgent`, `updateSession` (Flutter data source) — all **LOW**
  risk, additive-only (new optional param / new no-op-by-default branch).
- GitNexus `detect_changes()` (unstaged) → `risk_level: medium` (expected:
  touching `AgentSessionsController.update` fans out to many test-double
  overrides), 3 affected processes all rooted at `update` itself — no
  surprise symbols.

## Notes

- **Design tension acknowledged, not silently overridden**: the WS
  `session.input` per-turn `agent` override (`ws_gateway.ts` line ~293,
  "OPC-M4-4 ... never persisted") is UNCHANGED — that per-turn override
  path still exists for the one-off "use a different agent for just this
  message" case. This fix adds a SEPARATE, explicit persistence write
  (`PATCH agentId`) triggered from the same UI action (picking a profile
  from the pill), because the issue's acceptance criteria require the pill
  selection itself to be durable. If a future ticket wants a true one-off
  (non-persisted) per-turn override UI distinct from "switch my session's
  profile," that would need a second, separate affordance — out of scope
  here.
- **Known limitation (documented, not fixed — out of acceptance scope)**:
  resetting to "`<manager> (default)`" via the pill (`setSelectedAgent(id,
  null)`) is still local-only; it does not clear the persisted
  `agent_kind`. If a user explicitly picks a profile, then explicitly
  resets to default, then restarts, the restored profile will be the
  earlier explicit pick, not the reset default. None of the 4 acceptance
  criteria require this; flagging for a possible follow-up issue.
- `resolveProfileScope`/create/resume all expect `agentId` to be the
  already-resolved ENGINE kind (`agentConfig.ocAgent ?? id`), not
  necessarily the raw `agent_configs.id` for UUID-keyed profiles. The
  Flutter pill's `value: p.ocAgent ?? p.id` already computes exactly this
  same resolved form (mirrors `resolvedEngineAgentKind` server-side), so
  the new PATCH write intentionally does **not** re-validate against
  `AgentConfigsRepository` (unlike `resume()`'s validated path) — it trusts
  the client-resolved value as-is, consistent with how `ws_gateway.ts`'s
  per-turn `scopeAgentId` already treats an unrecognized value
  (`resolveProfileScope` never throws; unknown → graceful no-restriction
  default).

## Acceptance criteria status

- [x] A session's selected profile is persisted when chosen.
- [x] On app restart, resuming a session restores its last-active profile
      (not the default) — proven via a fresh-repository-instance read +
      real `GET /agent-sessions/:id` HTTP call.
- [x] If no profile was ever explicitly selected, existing default behavior
      is unchanged — proven (a PATCH omitting `agentId` leaves the row
      untouched).
- [~] The active-profile indicator in the UI reflects the restored profile
      after restart — proven at the DATA layer (`selectedAgentFor()`'s
      existing step-2 fallback reads the now-persisted `agentId`, and the
      pill's label-resolution loop matches on that same value against
      `AgentConfigsController.sessionSelectableAgents`). **Not** verified
      via an actual `⌘Q` + relaunch manual smoke — see below.

## Manual smoke still needed

Yes — this bug is specifically about a REAL app restart, and the fix's UI
observability (criterion 4) is only proven at the data/resolution-logic
layer here, not end-to-end through an actual process restart. Recommend:

1. Launch Rhythm normally (not the sandbox — this is a real restart
   check). Open a chat session, use the agent-selector pill (bottom of the
   composer, right of the permission-mode picker) to switch to a
   non-default profile (e.g. Coding Workflow).
2. Send at least one message so the session is clearly persisted.
3. Fully quit (⌘Q) and relaunch Rhythm.
4. Reopen the same session from the chat list.
5. Confirm the agent-selector pill shows Coding Workflow (not Secretary/
   default), and that it is styled as "overridden" (accent border) per
   `hasExplicitAgentSelection`.
