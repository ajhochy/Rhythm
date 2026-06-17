# MCP-5: Curated autoinstall trigger wiring

## Summary

Wire up the curated MCP autoinstall trigger in the Flutter app. Implement a new `CuratedMcpAutoInstaller.ensure()` that POSTs to `/opencode/mcp/curated/ensure`, with a `shouldAutoInstallCuratedMcp(...)` gate that mirrors the existing rhythm installer. Call from `agent_server_controller.dart`, with deduplication and non-fatal error handling.

## Goal

- New `CuratedMcpAutoInstaller.ensure()` POSTs to `${agentLocalBaseUrl}/opencode/mcp/curated/ensure`
- Returns `true` on 2xx, `false` (non-fatal) on server error or exception
- `shouldAutoInstallCuratedMcp(engineReady, authenticated, isCloudServer)` returns true only when all three hold
- Called from `agent_server_controller` with deduplication (one per token)
- Non-fatal; server failures do not crash the app

## Likely Files

- `apps/desktop_flutter/lib/app/core/agents/curated_mcp_auto_installer.dart` (new)
- `apps/desktop_flutter/lib/app/core/server/agent_server_controller.dart`

## Test Files

- `apps/desktop_flutter/test/app/core/agents/curated_mcp_autoinstall_test.dart` (new, mirror `f2_rhythm_mcp_autoinstall_test.dart`)

## Dependencies

- **MCP-2** (ensure endpoint must exist)

---

## Acceptance Criteria

### c1: POST to curated/ensure endpoint
- `CuratedMcpAutoInstaller.ensure()` POSTs to `${agentLocalBaseUrl}/opencode/mcp/curated/ensure`
- Request body, headers, and auth are correct
- Returns `true` on HTTP 2xx response

### c2: Non-fatal error handling
- Returns `false` (non-fatal) on server error (4xx, 5xx)
- Returns `false` (non-fatal) on thrown exception (timeout, connection error, etc.)
- Never throws from `ensure()`
- Logs the error for debugging

### c3: Gate logic
- `shouldAutoInstallCuratedMcp(engineReady, authenticated, isCloudServer)` returns true only when:
  - `engineReady` is true AND
  - `authenticated` is true AND
  - `isCloudServer` is true
- Returns false if any condition is false

### c4: Deduplication
- `agent_server_controller` invokes `ensure()` once per distinct token
- Calling multiple times with the same token does not trigger multiple POSTs
- De-dupe assertion in test verifies deduplication counter
