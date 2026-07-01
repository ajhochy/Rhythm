# memory: re-route memory MCP tools to the local agent server (:4001), not prod

**Order:** 3 · **Depends on:** #2 (vault-first write live on :4001) · **Milestone:** Memory vault as source of truth

## Why

The core topology bug: `apps/mcp_server/src/tools/agentMemory.ts` calls
`RHYTHM_API_URL`, which the desktop app sets to `serverConfig.url` = **production**
(`settings_view.dart:862`; also written into `opencode.json` by
`opencode_client_service.ts:1627`). So agent memories go to prod Postgres while the
Flutter UI (`agent_memory_data_source.dart`) reads `localhost:4001`. The memory tools
must point at the **local** agent server, exactly like agent sessions already do via
`AppConstants.agentLocalBaseUrl` and the existing `RHYTHM_AGENT_URL`
(default `http://localhost:4001`, already used by `notifications`/`agentDelegation`).

## What

1. In `apps/mcp_server/src/index.ts`, register the memory tools with `RHYTHM_AGENT_URL`
   (the local base), not `RHYTHM_API_URL` — mirroring `notifications`/`agentDelegation`.
2. In `apps/mcp_server/src/tools/agentMemory.ts`, ensure all four tools
   (`rhythm_remember_memory`, `rhythm_search_memory`, `rhythm_list_memories`,
   `rhythm_forget_memory`) use the local base.
3. Ensure the desktop config writers set `RHYTHM_AGENT_URL` to `localhost:4001` for the
   MCP server (Flutter `settings_view.dart` snippet + `opencode_client_service.ts`
   env write), and that changing the prod Settings URL does NOT affect it.

## Acceptance criteria

1. With the prod Settings URL set to `https://api.vcrcapps.com`, calling
   `rhythm_remember_memory` results in a vault note + local index row on `:4001` and
   **nothing written to prod** (verified by asserting the tool's resolved base is
   `localhost:4001`).
2. Changing the prod Settings URL to any value leaves the memory tools' base unchanged
   (still `:4001`) — same invariant the agent-sessions data source already holds.
3. `rhythm_search_memory` / `rhythm_list_memories` return memories from the local store
   (the same store the Flutter memory UI reads), so agent and UI now agree.
4. Existing mcp_server tests updated to reflect the local base for memory tools; suite green.

## Likely files

- `apps/mcp_server/src/index.ts` (registration base for memory tools)
- `apps/mcp_server/src/tools/agentMemory.ts`
- `apps/desktop_flutter/lib/features/settings/views/settings_view.dart` (~L862 config snippet)
- `apps/api_server/src/services/opencode_client_service.ts` (~L1627 env write)
- `apps/api_server/src/routes/opencode_mcp_routes.ts` (~L199 apiUrl default — confirm memory uses agent base)

## Required tests

- `apps/mcp_server/src/__tests__/agentMemory_local_base.test.ts` (new): memory tools
  resolve to `:4001`; prod URL change is inert.
- Update `apps/api_server/src/__tests__/opc_rhythm_mcp_ensure.test.ts` if it asserts the
  memory base.
- Flutter: `flutter analyze --no-fatal-infos` clean if `settings_view.dart` changes.

## Safety notes

- Do NOT couple memory traffic to `serverConfigService.url` (explicit dual-endpoint rule).
- Keep `RHYTHM_API_URL` for non-memory tools that legitimately hit prod — change only the
  memory tools' base.
- `dart format .` before committing any Flutter change.
