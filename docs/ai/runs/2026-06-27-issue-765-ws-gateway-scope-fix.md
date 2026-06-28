---
date: 2026-06-27
repo: Rhythm
branch: codex/fix-secretary-agent-scope
pr: "https://github.com/ajhochy/Rhythm/pull/771"
issues: ["#765"]
status: verified-pending-smoke
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# Issue #765 — ws_gateway Per-Turn MCP Scope Fix

## Root Cause (diagnosed this run)

The Flutter app creates agent sessions **without an agentId** (`agentId: null`
→ `agent_kind = 'claude-code'`). The real profile is selected per-turn in the
composer and arrives on the WS frame as `agent: 'secretary'`.

`ws_gateway.handleInputFrame` was resolving profile scope from
`session.agentKind` (`'claude-code'`), which has no `allowed_mcps_json` →
null `mcpRoleConfig` → ALL MCP tools visible to the model. The Secretary
profile's 7-server restriction was never applied on the interactive path.

The prior smoke (2026-06-27, `2026-06-27-secretary-mcp-scope-smoke-fail.md`)
confirmed this: the Secretary session saw Ableton, Canva, NFL, and ProPresenter
— all outside Secretary's allowed set.

## Files Changed

| File | Change |
|---|---|
| `apps/api_server/src/repositories/agent_sessions_repository.ts` | Added `setMcpScope(id, mcpRole, mcpAllowedToolsJson)` method |
| `apps/api_server/src/services/ws_gateway.ts` | Use `perTurnAgent ?? agentKind ?? null` as `scopeAgentId` for `resolveProfileScope`; persist resolved scope via `setMcpScope` |
| `apps/api_server/src/__tests__/ws_gateway_per_turn_scope.test.ts` | 3 new contract tests (c1: per-turn agent drives scope; c2: no-agent fallback; c3: scope cleared on switch) |

Prior commits on this branch (c0d8ae2c8, d46853fec) fixed and tested the REST
create path (`POST /agent-sessions` with explicit `agentId`). This commit
(`4789dd17a`) closes the ws_gateway interactive-path gap.

## Checks Run

- `npx tsc --noEmit` → exit 0
- `npx vitest run` → 150 files, 1285 tests, all passed
- `npm run build` → exit 0

## Notes

- Previous agent (different session) diagnosed the root cause fully and wrote
  the ws_gateway fix. This session picked up from their uncommitted changes,
  completed the contract test, committed, and opened the PR.
- Test falsification: if the fix is reverted, `resolveProfileScope('claude-code')`
  returns null `mcpRoleConfig` → `setMcpScope(id, null, null)` → `row.mcpRole`
  stays null → ws-c1 assertion fails.
- Live smoke required before merging: confirm Secretary session via composer
  receives only rhythm MCP tools.
