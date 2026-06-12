# OPC-M4-2 — Session fork

**Milestone:** M4 — Input & config
**Branch:** `opc-m4-2-session-fork`
**Depends on:** OPC-M1-5

## Summary

"Fork from here" on an assistant message calls `POST /session/{id}/fork` (typed wrapper) with
the message id, then creates a local session row mapped to the new SDK session id (name
"`<parent> (fork)`", same cwd), registers its stream, and persists/copies the transcript up to
the fork point so the new session hydrates correctly. The forked session appears in the active
list and is immediately promptable.

## Motivation

Audit B ABSENT: "fork". Lets users branch an exploration ("try a different approach from step
3") without destroying the original — the safe sibling of revert (M3-2).

## Likely files

- `apps/api_server/src/services/opencode_client_service.ts` (fork wrapper)
- `apps/api_server/src/controllers/agent_sessions_controller.ts` (fork route: SDK fork + local row + map + stream + message copy)
- `apps/api_server/src/repositories/agent_sessions_repository.ts` / messages repo
- `apps/desktop_flutter/lib/features/agents/controllers/agents_controller.dart`
- `apps/desktop_flutter/lib/features/agents/views/agents_view.dart` (action row + optimistic list insert)

## Acceptance criteria

1. `POST /agent-sessions/:id/fork` body `{messageId}` invokes the SDK fork wrapper with (sdkId, messageId), inserts a local row with the new `sdk_session_id`, populates `opencodeSessionMap`, and returns 201 with the new session (vitest, spy + DB asserts).
2. The new session's persisted messages equal the parent's messages up to and including the fork message (DB assert on copied rows; parts_json intact).
3. SDK fork failure → AppError; no local row is left behind (rollback assert).
4. "Fork from here" in the message action row dispatches the call; the new session appears in the active list (optimistic, reconciled by REST response) and selecting it shows the copied transcript (controller/widget tests with fakes).
5. Prompting the fork routes input to the fork's sdk id, not the parent's (vitest via map).
6. `ai-workflow checks --level pr` exits 0; vitest + flutter test green.

## Required tests

- vitest: fork route contract (c1-c3, c5).
- flutter test: `opc_m4_2_fork_test.dart` (c4).

## Out of scope

- Visual timeline/branch graph. Forking forked sessions is allowed but gets no special UI.
