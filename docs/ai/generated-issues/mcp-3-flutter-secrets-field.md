# MCP-3: Per-server env-secrets field in Add-MCP dialog

## Summary

Extend the Add-MCP dialog (`_AddMcpServerDialog`) with a key/value secrets editor. `McpController.addServer` and `McpDataSource.addServer` must accept an `environment` map and send it in the POST body to the API.

## Goal

- `_AddMcpServerDialog` gains a key/value secrets editor widget
- Adding rows + confirming calls `addServer` with a non-empty `environment` map
- `McpController.addServer(environment:{...})` forwards the map to the data source
- `McpDataSource.addServer` includes `environment` in the POST JSON body
- Dialog with no secret rows sends `environment` omitted/empty (backward-compat)

## Likely Files

- `apps/desktop_flutter/lib/features/settings/widgets/mcp_section.dart`
- `apps/desktop_flutter/lib/features/settings/controllers/mcp_controller.dart`
- `apps/desktop_flutter/lib/features/settings/data/mcp_data_source.dart`

## Test Files

- `apps/desktop_flutter/test/features/settings/widgets/opc_m4_3_mcp_section_test.dart` (extend existing)

## Dependencies

- **MCP-1** (environment map plumbing on backend)

---

## Acceptance Criteria

### c1: Dialog renders secrets editor
- Add-MCP dialog renders a key/value secrets editor with widget key `mcp-dialog-env-add`
- User can add rows (key/value pairs)
- User can confirm with non-empty `environment` map
- Fake data source captures the environment map correctly

### c2: Controller forwards environment
- `McpController.addServer(environment:{...})` forwards the map to the data source
- Controller passes all other params (name, command, etc.) unchanged

### c3: Data source includes environment in POST
- `McpDataSource.addServer` includes `environment` in the POST JSON body
- Assert request body contains `{name, command, environment:{...}}`
- HTTP POST is sent to correct endpoint

### c4: Backward-compat with no secrets
- Dialog with no secret rows sends `environment` omitted or empty `{}`
- No regression for command/url-only entries
- Existing tests pass
