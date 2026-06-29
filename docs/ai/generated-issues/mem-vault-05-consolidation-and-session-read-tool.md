# memory: add `rhythm_list_sessions` MCP tool + consolidation writes facts as vault notes

**Order:** 5 · **Depends on:** #2 (vault write), #3 (local tool base) · **Milestone:** Memory vault as source of truth

## Why

`agentMemoryService.seedConsolidationTask()` seeds a daily task whose prompt tells the
agent to use `rhythm_list_sessions` — but that MCP tool **does not exist** (confirmed:
no session-reading tool anywhere in `apps/mcp_server/src`). So consolidation can't read
sessions today. The local agent server already exposes `GET /agent-sessions` and
`GET /agent-sessions/:id/messages`; this issue surfaces them as an MCP tool and makes
consolidation write its distilled facts as **vault notes** (via the #2 write path), not
prod DB rows.

## What

1. Add a `rhythm_list_sessions` MCP tool (new
   `apps/mcp_server/src/tools/agentSessions.ts`) backed by the local agent server
   (`RHYTHM_AGENT_URL`/:4001): list sessions and, given a session id, return its messages.
   Field set: confirm with maintainer (Known Ambiguity #4) — at minimum session id,
   name, agentKind, last-activity; message bodies for the consolidation read.
2. Register it in `apps/mcp_server/src/index.ts` against the local agent base.
3. Verify `seedConsolidationTask()`'s prompt references only tools that now exist
   (`rhythm_list_sessions`, `rhythm_search_memory`, `rhythm_remember_memory`), and that
   the facts it writes land in the vault (through #2) — not prod.

## Acceptance criteria

1. `rhythm_list_sessions` returns the local agent server's sessions; given a session id,
   returns that session's messages — matching `GET /agent-sessions(/:id/messages)` on :4001.
2. The tool's resolved base is `localhost:4001`, unaffected by the prod Settings URL.
3. `seedConsolidationTask()` remains idempotent (still no-ops if a "Memory Consolidation"
   task exists) and its prompt names only existing MCP tools.
4. A simulated consolidation run that calls `rhythm_remember_memory` produces vault notes
   + index rows (not prod rows) — i.e. it rides the #2/#3 path.
5. mcp_server suite green; the new tool has unit coverage.

## Likely files

- `apps/mcp_server/src/tools/agentSessions.ts` (new)
- `apps/mcp_server/src/index.ts` (register against `RHYTHM_AGENT_URL`)
- `apps/api_server/src/services/agentMemoryService.ts` (`seedConsolidationTask` prompt text)
- (read-only) `apps/api_server/src/controllers/agent_sessions_controller.ts` to confirm response shape

## Required tests

- `apps/mcp_server/src/__tests__/agentSessions_tool.test.ts` (new): lists sessions +
  messages from the local base; base is :4001.
- `apps/api_server/src/__tests__/` consolidation-seed test: prompt references only
  existing tools; seed idempotent.

## Safety notes

- Session contents are private — never log message bodies; the tool returns them only to
  the local agent.
- Tool base must be local (:4001), never prod.
- Do not change session storage; this is read-only over existing endpoints.
