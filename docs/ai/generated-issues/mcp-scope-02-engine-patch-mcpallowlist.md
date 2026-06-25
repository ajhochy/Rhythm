# [mcp-scope-02] Engine patch: per-session `mcpAllowlist` schema gate + fork-side test

**Plan:** Per-session MCP tool-schema injection scoping
**Branch:** `feature/agent-scheduler`
**Dependencies:** mcp-scope-01
**Blocks:** mcp-scope-03, mcp-scope-04

---

## Context

The opencode engine currently injects **every** connected MCP server's tool
schemas into the model context on every prompt, regardless of the session's Agent
Profile. This is the root cause of excessive token consumption for "lite" profiles
like Secretary and Librarian.

**The fix is a minimal two-file patch to the vendored fork:**

In `session/session.ts`, add `mcpAllowlist` to `Session.Info` (line 206) and
`CreateInput` (line 241):
```ts
mcpAllowlist?: { servers: string[]; tools: string[] }
```

In `session/prompt.ts`, gate the `resolveTools` MCP loop (lines 608-693 in
v1.14.49). The engine must build a `composedKey → serverName` index from the same
`MCP.tools()` / `clientName` data it already has in scope, then apply the
predicate:
```ts
const ix = serverIndex[key]; // serverName for this composedKey
if (mcpAllowlist && !(mcpAllowlist.tools.includes(key) || mcpAllowlist.servers.includes(ix))) continue;
```

When `mcpAllowlist` is `undefined` → no filtering; all MCP tool schemas are
injected exactly as upstream (back-compat preserved).

**Structured allowlist design (resolved R2):**
- `servers: string[]` — server names whose tools are all allowed (inherit-all).
  Used when a role's `allowedTools` array is empty/missing for that server.
- `tools: string[]` — explicit sanitized `<server>_<tool>` composite ids.
  Used when `allowedTools` is a non-empty list.
- The expander (Issue 05) populates whichever field is appropriate; the engine
  simply checks both lists.
- `disabledMcpServers` (e.g. bash, computer, editor, filesystem) are native tools,
  not MCP — they are outside the scope of this MCP filter and are a future
  native-permission concern.
- The `composedKey → serverName` index must be built from `MCP.tools()` data
  already in scope at `mcp/index.ts:684` where `clientName` is available, NOT via
  string-splitting on `_` (which would be ambiguous for hyphenated server names).

---

## Acceptance Criteria

- [ ] `apps/opencode_fork/packages/opencode/src/session/session.ts` — `Session.Info`
  has `mcpAllowlist?: { servers: string[]; tools: string[] }` added at line ~206;
  `CreateInput` has the same field added at line ~241.
- [ ] `apps/opencode_fork/packages/opencode/src/session/prompt.ts` — the
  `resolveTools` MCP loop (v1.14.49 lines 608-693) applies the predicate above,
  using a `composedKey → serverName` index built from `MCP.tools()` data, NOT
  string-splitting.
- [ ] **Fork-side unit test** (new file under `apps/opencode_fork/packages/opencode/`
  test directory, e.g. `src/session/mcp_allowlist_gate.test.ts`):
  - With `mcpAllowlist = { servers: [], tools: ['srvA_tool1'] }`, `resolveTools`
    output includes `srvA_tool1` and excludes `srvA_tool2`, `srvB_tool1`.
  - With `mcpAllowlist = { servers: ['srvB'], tools: [] }`, output includes all
    `srvB_*` tools and excludes all `srvA_*` tools.
  - With `mcpAllowlist = { servers: [], tools: [] }` (empty both), output has
    zero MCP tools.
  - With `mcpAllowlist = undefined`, output is identical to upstream (all tools
    present — no behavior change).
  - An id in `tools` that no server exposes is silently absent (no throw).
- [ ] `cd apps/opencode_fork && bun test` (or the fork's test command) exits 0.
- [ ] Existing `apps/api_server` tests unchanged: `cd apps/api_server && npx tsc --noEmit && npx vitest run` exits 0.
- [ ] **Inherited-baseline typecheck unblock (from mcp-scope-01 triage, 2026-06-25):**
  pristine upstream v1.14.49 ships **one** pre-existing `TS2416` in
  `packages/opencode/src/bus/global.ts:14` (`GlobalBusEmitter.emit` override is
  narrower than the `@types/node` 24.x `EventEmitter` base signature). It is
  unrelated to MCP and does NOT block the `bun build` binary (verified: bun
  transpiles the file at exit 0). Because this issue's typecheck gate requires
  `bun run typecheck` to exit 0, carry a **minimal, clearly-commented** type-only
  fix to that override signature (broaden to match the base, or a scoped
  annotation) so the opencode-package typecheck is green. Keep it ≤ a few lines to
  minimize `git subtree pull` conflict surface; note it in the vendoring decision
  doc as a carried patch.

---

## Likely Files

- `apps/opencode_fork/packages/opencode/src/session/session.ts` (lines 206, 241)
- `apps/opencode_fork/packages/opencode/src/session/prompt.ts` (lines 608-693 loop)
- `apps/opencode_fork/packages/opencode/src/session/mcp_allowlist_gate.test.ts` (new)

---

## Required Tests / Evaluation

| Check | Pass condition |
|---|---|
| Fork unit test — `tools` branch | `srvA_tool1` present, `srvA_tool2` + `srvB_*` absent |
| Fork unit test — `servers` branch | All `srvB_*` present, all `srvA_*` absent |
| Fork unit test — empty both | Zero MCP tools in output |
| Fork unit test — `undefined` allowlist | All tools present (back-compat) |
| Fork unit test — unknown id in list | No throw; silently absent |
| Fork typecheck | `bun run typecheck` exits 0 in `apps/opencode_fork` |
| api_server tsc + vitest | Unchanged pass |

---

## Safety Notes

- **Back-compat is mandatory.** `mcpAllowlist: undefined` MUST produce identical
  output to upstream. A session without a profile must not be affected.
- **No string-splitting.** The `composedKey → serverName` index must be derived
  from in-scope `clientName` metadata, not from splitting composite keys on `_`.
  Splitting would be ambiguous for hyphenated server names (e.g. `gmail-work`).
- **No changes to `mcp/index.ts`** or the MCP connection lifecycle. The patch is
  limited to `session.ts` and `prompt.ts`.
- **GitNexus:** run `impact({ target: "resolveTools", direction: "upstream" })`
  before editing `prompt.ts`. Run `detect_changes({ scope: "compare", base_ref: "main" })`
  before committing.
- **No merge to `main`.** Feature branch only.

---

## Open Questions — RESOLVED (orchestrator, 2026-06-25)

**R2 (Inherit-all servers):** The allowlist is structured — `{ servers, tools }`.
`servers[]` covers inherit-all (empty `allowedTools` in the role file → emit the
server name). `tools[]` covers explicit tool selection. The engine gate checks
both. The `composedKey → serverName` index resolves ambiguity without splitting.
This is the canonical design; no further user input required.
