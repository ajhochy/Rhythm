---
date: 2026-06-25
repo: Rhythm
branch: feature/agent-scheduler
pr: "#734 (draft, open — do not merge)"
issues: mcp-scope-02
status: PASS
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# mcp-scope-02 — Engine patch: per-session mcpAllowlist gate

## Files changed

| File | Change |
|---|---|
| `apps/opencode_fork/packages/opencode/src/session/mcp_allowlist.ts` | NEW — pure helper `filterMcpToolsByAllowlist(toolKeys, keyToServer, mcpAllowlist)` |
| `apps/opencode_fork/packages/opencode/src/session/session.ts` | Added `McpAllowlist` schema (mutable arrays); `mcpAllowlist` field on `Info`, `CreateInput`, `Interface.create`, `createNext`, `create` |
| `apps/opencode_fork/packages/opencode/src/session/prompt.ts` | Added import of `filterMcpToolsByAllowlist`; rewrote MCP loop to call `mcp.toolClientNames()`, build `allowedKeys` Set, and skip non-allowed keys |
| `apps/opencode_fork/packages/opencode/src/mcp/index.ts` | Added `toolClientNames()` to `Interface` + implementation (mirrors `tools()` key-building logic); registered in `Service.of` return |
| `apps/opencode_fork/packages/opencode/src/bus/global.ts` | Carried TS2416 fix: broadened `emit` override signature to `string | symbol, ...any[]` (upstream @types/node 24.x incompatibility) |
| `apps/opencode_fork/packages/opencode/test/session/prompt.test.ts` | Added `toolClientNames: () => Effect.succeed({})` to MCP mock |
| `apps/opencode_fork/packages/opencode/test/session/snapshot-tool-race.test.ts` | Added `toolClientNames: () => Effect.succeed({})` to MCP mock |
| `docs/ai/project-state.md` | Updated snapshot |

## Checks run

| Check | Result |
|---|---|
| `bun test src/session/mcp_allowlist.test.ts` | **5/5 PASS** |
| `bun run typecheck` (opencode fork) | **exit 0** — TS2416 fixed, 0 errors |
| `bun test src/session/` | **5 pass, 0 fail** |
| `npx tsc --noEmit` (api_server) | **exit 0** |
| `ai-workflow checks --level issue` | **exit 0** (flutter analyze ✓, dart format ✓, tsc ✓) |
| `ai-workflow checks --level pr` | **exit 0** (+ vitest ✓) |

## Notes

**Key design decision — `toolClientNames()` method (not string-split):**
The contract requires building `keyToServer` from MCP metadata, not by splitting
composed keys on `_`. Reason: hyphenated server names like `gmail-work` get
sanitized to `gmail_work`, so a split-on-`_` approach would mis-bucket them.
`toolClientNames()` mirrors `tools()` exactly: `sanitize(clientName) + "_" + sanitize(mcpTool.name)`.
See `docs/ai/decisions/2026-06-25-mcp-scope-02-toolclientnames.md`.

**Schema mutable arrays:** `Schema.mutable(Schema.Array(...))` used on `servers`/`tools`
to produce `string[]` (not `readonly string[]`) matching the Interface.create contract.
Mirrors `Permission.Ruleset` pattern already in the codebase.

**TS2416 fix:** broadened `GlobalBusEmitter.emit` override to accept `string | symbol, ...any[]`
and narrowed the behavior with a runtime `eventName === "event"` check. Preserves the
id-injection behavior. Tagged with `// Rhythm carried patch (mcp-scope): …` for
easy grep on future `git subtree pull`.

**GitNexus:** `resolveTools` not in the Rhythm index (expected — `apps/opencode_fork`
was just vendored). Impact analysis returned UNKNOWN, which is correct behavior.
Relied on contract test + back-compat assertion (criterion 4) instead.

**Smoke probes:** `localhost:4001` not started — opencode fork not yet wired into
api_server (issues 04/05). Smoke gap documented; expected at this issue level.

**Follow-ups / deferred:**
- Low-risk: `toolClientNames()` / `tools()` both read `s.defs[clientName]` synchronously from the same InstanceState snapshot. If a future MCP refactor makes these async/separate reads, ensure the snapshot is the same reference.
- Issue 05 (allowlist expander) and Issue 04 (api_server wiring) are next.
