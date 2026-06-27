---
date: 2026-06-25
repo: Rhythm
branch: feature/agent-scheduler
pr: null
issues: [mcp-scope-06]
status: complete
tags: [run, rhythm, verification]
index: "[[Rhythm]]"
---

# mcp-scope-06 — Verification & acceptance measurement

Final gate for per-session MCP tool-schema scoping. The token-reduction claim:
a Secretary session injects only its profile's allowlisted MCP tool schemas, not
every connected server's schemas.

## Measurement instrument added

`apps/opencode_fork/packages/opencode/src/session/prompt.ts` `resolveTools` now
emits a DEBUG log just before returning the tools record:

```
log.debug("resolveTools complete", {
  resolveToolsCount: Object.keys(tools).length,
  allowlistActive: !!input.session.mcpAllowlist,
})
```

`resolveToolsCount` = tool schemas injected into model context; `allowlistActive`
= whether the session was profile-scoped (false → all tools, back-compat).

## Acceptance — established by composition (automated)

R4 requires the Secretary injected count to equal `expandMcpAllowlist(secretaryConfig).tools.length`
**dynamically** (no hardcoded number). This is proven by the union of three suites:

1. **Expander** (`mcp_allowlist_expander.test.ts` C2): `expandMcpAllowlist(secretary)` →
   `tools.length = 36` (rhythm 14, gmail-work 2, gmail-personal 2, calendar 3,
   obsidian 9, pdf-tools 6; `servers: []`; native `disabledMcpServers` excluded).
2. **api_server wiring** (`opencode_client_service.test.ts`): a session created with a
   `McpRoleConfig` sends `mcpAllowlist` deep-equal to `expandMcpAllowlist(config)` on the
   `session.create` body.
3. **Engine gate** (`mcp_allowlist_e2e.test.ts`): the real `resolveTools` flow filters the
   tools offered to the model to **exactly** the received allowlist — 5→3→1→0 across
   no-profile / server-scoped / tool-scoped / empty-allowlist.

Composed: a Secretary session offers exactly `expandMcpAllowlist(secretaryConfig).tools.length`
(= 36) MCP tool schemas. The profile-less control (no `mcpAllowlist`) offers all connected
MCP tools (e2e Case A: full set), proving back-compat.

## Counts

| Case | allowlistActive | injected MCP tool count |
|---|---|---|
| Secretary profile | true | 36 (== `expandMcpAllowlist(secretary).tools.length`) |
| Profile-less (control) | false | all connected MCP tools (baseline; > 36) |

The exact unscoped baseline depends on which MCP servers are connected at runtime
(~20 global servers, hundreds of tools) — record the live `resolveToolsCount` for the
profile-less control during the manual smoke to quantify the reduction.

## Checks run

- fork `bun run typecheck` → exit 0 (with the DEBUG log added)
- fork `bun test test/session/mcp_allowlist_e2e.test.ts` → 4/4 (gate unaffected by log)
- fork `bun test test/session/ src/session/` → 330 tests, 0 fail
- Secretary expander count recomputed from `.mcp-roles/secretary.mcp.json` → 36

## Remaining: live full-stack smoke (manual, post-release)

The numeric acceptance is proven in automation. The LIVE confirmation — open a
Secretary session in the running app and read `resolveToolsCount: 36, allowlistActive: true`
from the engine log, plus a profile-less control showing a higher count — requires the
patched fork binary actually running (locally-built on PATH, or the bundled binary from a
release). This is the post-merge manual smoke (see docs/ai/testing-guide.md "MCP allowlist
smoke"). Not exercised in this run because no release was triggered (per user direction).
