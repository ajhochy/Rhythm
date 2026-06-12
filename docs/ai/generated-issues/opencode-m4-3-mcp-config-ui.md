# OPC-M4-3 — MCP server management UI

**Milestone:** M4 — Input & config
**Branch:** `opc-m4-3-mcp-config-ui`
**Depends on:** OPC-M1-1

## Summary

Settings → new "MCP Servers" section (sibling of `ai_account_section.dart`): list configured
MCP servers with connection status, add a server (name + command/url form for local/remote
types), connect/disconnect, and remove — all proxied through typed wrappers over the SDK's
`/mcp` API via new `routes/opencode_mcp_routes.ts`. Follows the feature-layer pattern
(data source → repository → ChangeNotifier controller → view) and theme tokens.

## Motivation

Audit B ABSENT: "MCP config UI". MCP is how Rhythm's own tooling (e.g. the Rhythm MCP server)
gets attached to agent sessions; today it requires hand-editing opencode config files, which
church staff cannot do.

## Likely files

- `apps/api_server/src/routes/opencode_mcp_routes.ts` (new)
- `apps/api_server/src/services/opencode_client_service.ts` (listMcp/addMcp/connectMcp/disconnectMcp/removeMcp wrappers)
- `apps/desktop_flutter/lib/features/settings/widgets/mcp_section.dart` (new)
- `apps/desktop_flutter/lib/features/settings/controllers/mcp_controller.dart` (new)
- `apps/desktop_flutter/lib/features/settings/data/mcp_data_source.dart` (new, baseUrl = `AppConstants.agentLocalBaseUrl`)
- `apps/desktop_flutter/lib/main.dart` (provider wiring)

## Acceptance criteria

1. `GET /opencode/mcp` returns the SDK's MCP server list (vitest spy + real-shape fixture: name, type, connection status); `POST /opencode/mcp` (add), `POST /opencode/mcp/:name/connect`, `POST /opencode/mcp/:name/disconnect`, `DELETE /opencode/mcp/:name` each invoke the corresponding typed wrapper; SDK errors → AppError with message.
2. The section lists each server with name + status badge (connected/disconnected/error using success/textMuted/danger roles); empty state shows guidance text (widget test).
3. Add-server dialog validates required fields (name + command-or-url) and dispatches the add call; the list refreshes on success (controller test with fake data source).
4. Connect/disconnect buttons dispatch their calls and update the row's status from the refetched list; failures surface inline error text, not silence.
5. MCP data source hard-codes `AppConstants.agentLocalBaseUrl` (never `serverConfigService.url`) — unit assert mirroring issue #644's contract pattern.
6. `ai-workflow checks --level pr` exits 0; vitest + flutter test green.

## Required tests

- vitest: `opc_m4_3_mcp_routes.test.ts` (c1).
- flutter test: `opc_m4_3_mcp_section_test.dart` (c2-c5).

## Out of scope

- MCP OAuth flows (SDK supports them; defer to a follow-up — note in the section UI when a server reports auth-required). Per-session MCP enable/disable.
