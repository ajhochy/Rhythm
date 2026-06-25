---
date: 2026-06-25
repo: Rhythm
tags: [decision, Rhythm]
index: "[[Rhythm]]"
---

# Decision: `toolClientNames()` method for composedKey → serverName mapping

## Context

Issue mcp-scope-02 requires `resolveTools` in `prompt.ts` to build a
`keyToServer: Record<string, string>` index (composedKey → raw clientName) so
`filterMcpToolsByAllowlist` can check server-level allowlist entries without
string-splitting composed keys on `_`.

The problem: `mcp.tools()` returns `Record<string, Tool>` (AI SDK `Tool` objects),
which carry no `clientName` metadata. The composedKey is `sanitize(clientName) + "_" + sanitize(mcpTool.name)`.

## Decision

Add a new `toolClientNames(): Effect.Effect<Record<string, string>>` method to
the MCP `Interface` and its layer implementation. It mirrors the `tools()` loop
exactly — iterating connected clients and their cached `defs` — and returns only
the composedKey → clientName mapping (no Tool objects).

## Alternatives considered

1. **String-split on `_`** — rejected. `sanitize()` maps any non-`[a-zA-Z0-9_-]`
   to `_`, including `-`. A server named `gmail-work` produces key prefix
   `gmail_work`. Splitting `gmail_work_read_email` on `_` is ambiguous: is it
   `gmail_work` + `read_email` or `gmail` + `work_read_email`? The contract
   explicitly forbids this approach.

2. **Embed `clientName` on the `Tool` object in `convertMcpTool`** — would require
   a new wrapper type since AI SDK's `Tool` has no `clientName` field. More
   invasive change to a type boundary shared with upstream.

3. **Call `mcp.clients()` + enumerate defs separately in `prompt.ts`** — would require
   `prompt.ts` to reach into MCP internals (`defs` cache) which is not exposed. Less
   cohesive than a purpose-built MCP method.

## Consequences

- Adds one method to the MCP `Interface` (a public API surface in the fork).
- Any test mocking `MCP.Service.of({...})` must stub `toolClientNames` → two test
  files updated (`prompt.test.ts`, `snapshot-tool-race.test.ts`).
- Key-building logic is now duplicated between `tools()` and `toolClientNames()`.
  Risk: if `tools()` key format changes, `toolClientNames()` must change in tandem.
  Mitigation: the two implementations are adjacent in `mcp/index.ts`; the comment
  tags them both with "Rhythm carried patch (mcp-scope)".
- On `git subtree pull`, both methods need a conflict-aware rebase. Documented in
  `docs/ai/decisions/2026-06-25-opencode-fork-vendoring.md`.
