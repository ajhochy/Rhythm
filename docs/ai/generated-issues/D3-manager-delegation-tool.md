# D3 — Manager delegation tool

**Labels:** `api-server`, `mcp`, `agents`, `p4`
**Design authority:** `docs/ai/decisions/2026-06-24-manager-delegation.md`
**Depends on:** D1, D2

## Goal

Expose `rhythm_delegate` only to manager profile sessions and wire it to the D2 delegation service.

## Acceptance Criteria

- [ ] Manager profile sessions receive a `rhythm_delegate` tool definition.
- [ ] Non-manager profile sessions do not receive the tool.
- [ ] Tool input accepts `targetConfigId`, `prompt`, and optional context.
- [ ] Tool handler calls the delegation service and returns the delegate output.

## Likely Files

- `apps/api_server/src/services/agent_profile_scope.ts`
- `apps/api_server/src/services/agent_delegation_service.ts`
- `apps/api_server/src/services/agent_runner.ts`
- MCP/tool registration seam in the API server.

## Required Tests

- Add Vitest coverage for tool exposure and handler wiring.
