# [mcp-scope-05] Allowlist expander: role JSON → structured `{ servers, tools }` allowlist

**Plan:** Per-session MCP tool-schema injection scoping
**Branch:** `feature/agent-scheduler`
**Dependencies:** none (can be built in parallel with issues 01/02)
**Blocks:** mcp-scope-04

---

## Context

Agent Profiles live in `.mcp-roles/*.mcp.json`. Each file has:
```json
{
  "mcpServers": {
    "obsidian": { "inherit": true, "allowedTools": ["obsidian_get_file", ...] },
    "rhythm":   { "inherit": true, "allowedTools": [] }
  },
  "disabledMcpServers": ["bash", "computer", "editor", "filesystem"]
}
```

`allowedTools` is an array of bare tool names (not yet composite). When the array
is **empty or missing**, the intent is **inherit-all** — the session gets every
tool that server exposes.

The expander is a **pure function** that converts this config object into the
structured `{ servers: string[], tools: string[] }` shape the engine expects
(see Issue 02):
- Server with empty/missing `allowedTools` → emit server name into `servers[]`.
- Server with non-empty `allowedTools` → sanitize and emit each tool into `tools[]`
  as `<sanitizedServer>_<sanitizedTool>`.
- Servers in `disabledMcpServers` are excluded from both lists.

**Sanitize rule (canonical):**
```ts
const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_');
```
Hyphens are preserved (`gmail-work` → `gmail-work`). Dots, colons, and slashes
→ `_`. Apply to BOTH the server segment AND the tool segment independently.

**Note on `disabledMcpServers`:** The role files disable native tool names (bash,
computer, editor, filesystem). These are native opencode tools, not MCP servers.
The expander must exclude them from the `servers[]` list if they appear in
`mcpServers` (unlikely but safe to guard). They do not affect `tools[]` since
they won't appear in `allowedTools` arrays.

---

## Acceptance Criteria

- [ ] New file `apps/api_server/src/services/mcp_allowlist_expander.ts` exports:
  ```ts
  export interface McpAllowlist { servers: string[]; tools: string[] }
  export function expandMcpAllowlist(roleConfig: MfcRoleConfig): McpAllowlist
  ```
  where `McpRoleConfig` is the existing type from `agent_profile_scope.ts`.
- [ ] Sanitize rule applied to BOTH server and tool name segments independently.
- [ ] **Librarian profile** (`librarian.mcp.json`): all tools are explicit →
  `servers: []`, `tools: ['obsidian_obsidian_get_file', 'obsidian_obsidian_put_file',
  ..., 'rhythm_rhythm_ping', ...]` — every entry in `obsidian.allowedTools` and
  `rhythm.allowedTools` present as `<server>_<tool>`, and `tools.length` equals
  the sum of both `allowedTools` arrays.
- [ ] **Inherit-all server:** a server with empty `allowedTools: []` → its
  sanitized name appears in `servers[]`, not in `tools[]`.
- [ ] **Hyphenated server name:** `gmail-work` with `allowedTools: ['search_emails']`
  → `tools[]` contains `'gmail-work_search_emails'` (hyphen preserved in server
  segment; underscore preserved in tool segment).
- [ ] **Dot/colon in name:** a server named `my.server` with tool `get:data` →
  `'my_server_get_data'` (both segments sanitized).
- [ ] **`disabledMcpServers` exclusion:** any server name appearing in
  `disabledMcpServers` is excluded from both `servers[]` and `tools[]`.
- [ ] **Empty mcpServers:** returns `{ servers: [], tools: [] }`.
- [ ] `apps/api_server/src/services/__tests__/mcp_allowlist_expander.test.ts`
  (new) covers all cases above; `npx vitest run` exits 0.
- [ ] `npx tsc --noEmit` in `apps/api_server` exits 0 (no new type errors).

---

## Likely Files

- `apps/api_server/src/services/mcp_allowlist_expander.ts` (new)
- `apps/api_server/src/services/__tests__/mcp_allowlist_expander.test.ts` (new)
- `apps/api_server/src/services/agent_profile_scope.ts` (import expander at the
  call site; no structural change to `McpRoleConfig` type)

---

## Required Tests / Evaluation

| Test case | Expected output |
|---|---|
| Librarian config | `servers: []`; `tools` has exactly `obsidian.allowedTools.length + rhythm.allowedTools.length` entries, all prefixed correctly |
| Inherit-all server (empty `allowedTools`) | Server name in `servers[]`; nothing in `tools[]` for that server |
| Hyphenated server name | Hyphen preserved in composite id |
| Dot/colon in server or tool name | Both replaced with `_` |
| `disabledMcpServers` exclusion | Excluded server absent from both lists |
| Empty mcpServers | `{ servers: [], tools: [] }` |
| Secretary config (all explicit tools) | All 6 server prefixes present in `tools[]`, `servers: []` |

Run:
```bash
cd apps/api_server && npx vitest run src/services/__tests__/mcp_allowlist_expander.test.ts
```

---

## Safety Notes

- **Pure function, no side effects.** The expander must not read files, call the
  database, or make HTTP requests. It operates on an already-parsed config object.
- **No live tool enumeration required.** Inherit-all is handled by emitting to
  `servers[]` — the engine already has the server's tool list in scope and will
  inject all of them. No API call to enumerate live tool ids is needed.
- **Do not change `McpRoleConfig`.** The existing type in `agent_profile_scope.ts`
  is the input; introduce no new fields on it.
- **GitNexus:** run `impact({ target: "resolveProfileScope", direction: "upstream" })`
  before touching `agent_profile_scope.ts`. The expander is a new symbol — no
  impact check needed for it, but do run `detect_changes` before committing.

---

## Open Questions — RESOLVED (orchestrator, 2026-06-25)

**R2 (Inherit-all design):** Inherit-all servers are emitted into `servers[]` (not
`tools[]`). No live tool enumeration is needed — the engine handles the "all tools
for this server" semantics on its side. The expander is purely structural.
