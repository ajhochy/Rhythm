---
date: 2026-06-25
repo: Rhythm
branch: feature/agent-scheduler
pr: null
issues: [mcp-scope-05]
status: complete
tags: [run, rhythm]
index: "[[Rhythm]]"
---

# mcp-scope-05 — Allowlist expander (role JSON → `{ servers, tools }`)

Pure function in api_server that converts a resolved `McpRoleConfig` into the
structured `{ servers, tools }` allowlist the engine consumes (mcp-scope-02).

## Files changed

- `apps/api_server/src/services/mcp_allowlist_expander.ts` (new) —
  `expandMcpAllowlist(roleConfig): { servers, tools }`. Inherit-all (empty/missing
  `allowedTools`) → server name in `servers[]`; explicit list → `sanitize(server)_sanitize(tool)`
  in `tools[]`; `disabledMcpServers` excluded from both; empty/null `mcpServers` → `{[],[]}`.
- `apps/api_server/src/services/__tests__/mcp_allowlist_expander.test.ts` (new) — 10 cases.
- `docs/ai/contracts/issue-mcp-scope-05.json` (new) — contract.

## Checks run

- `npx vitest run …/mcp_allowlist_expander.test.ts` → 10 pass / 0 fail ✓
- `npx tsc --noEmit` (api_server) → exit 0 ✓

## Notes

- **Real `McpRoleConfig` shape** (from `agent_profile_scope.ts`): `{ role,
  mcpServers: Record<string, unknown>, allowedToolsJson: string }`. `mcpServers`
  values are the resolved `{ allowedTools: string[] }` form built by
  `_buildMcpRoleConfig` (inherit-all → `{ allowedTools: [] }`). `disabledMcpServers`
  is NOT on the type — only in the on-disk JSON; the expander guards for it via cast.
  The expander's input assumption matches the resolved shape; Issue 04 will call it
  as `expandMcpAllowlist(profileScope.mcpRoleConfig)` (ProfileScope.mcpRoleConfig).
  `allowedToolsJson` is the raw source string (passthrough/cache) — no duplication
  or conflict with the expander.
- **Cross-issue correctness fix (orchestrator review):** the expander originally
  emitted the **sanitized** server name into `servers[]`, but the engine
  (mcp-scope-02) compares `mcpAllowlist.servers` against the **raw** clientName
  (`MCP.toolClientNames()` value is unsanitized). For real server names (all
  sanitize-invariant) this was harmless, but a dotted/colon server name would be
  silently over-restricted. Corrected the expander to emit the **raw** server name
  into `servers[]` (set-membership key, not a model-facing id); added regression
  test C5b asserting `my.server` stays raw. `tools[]` composed ids remain sanitized
  on both sides. Issue 05's spec text ("sanitized name in servers[]") was wrong on
  this point.
