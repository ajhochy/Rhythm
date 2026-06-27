---
date: 2026-06-24
repo: api_server
tags: [decision, api_server]
index: "[[Rhythm]]"
---

# P1a — Profile scope helper design decisions

## Context

P1a extracts a shared `resolveProfileScope()` helper from `agent_runner._runOnce` and wires the result into `ws_gateway.handleInputFrame`. Two design questions arose during implementation.

---

## Decision 1: Server-name array → `allowedTools:[]` (not per-tool gate)

**Problem:** The `agent_configs.allowed_mcps_json` column stores a JSON **array of server names** (e.g. `["rhythm","gmail-personal"]`). The existing scheduled-task path uses a JSON **tools map** (`{"rhythm":["tool1"]}`) from the `agent_scheduled_tasks.allowed_mcps_json` row. These are two different formats with different semantics.

**Decision:** For the server-name array (profile format), build `mcpServers[name] = { allowedTools: [] }` — the server is present in the config but with an empty tool-allowlist, meaning "this server is in scope; all of its tools are accessible."

**Alternatives considered:**
1. Look up the `.mcp-roles/*.mcp.json` file for the profile's server names to get the actual per-tool lists. Rejected: the profile doesn't carry a role slug; looking up by server name requires matching across all role files and has no unambiguous mapping.
2. Interpret `allowedTools: []` as "no tools allowed" (deny-all). Rejected: that would silently disable all scoped servers. The C1 design uses `[]` as "all tools" (an allowlist that is empty means "use the server's full tool set").

**Consequences:** Profile MCP scoping is server-level, not tool-level. A profile that lists `["rhythm"]` can use any rhythm tool. Tool-level restriction still requires an explicit role slug via the C1 `mcpRole` path. P1b can add finer-grained skill allowlisting via `allowedSkillsJson`.

---

## Decision 2: `async` signature for `resolveProfileScope`

**Problem:** All current DB calls inside `resolveProfileScope` use better-sqlite3 (synchronous). Making the function `async` is not strictly required today.

**Decision:** Mark `resolveProfileScope` as `async` anyway.

**Alternatives considered:**
1. Sync function. Would require the WS gateway to await a Promise.resolve() wrapper, and any P1b/P2 extension that adds async work (e.g. FTS lookup for allowedSkills) would need a signature change.
2. Async (chosen). Zero cost difference at runtime; keeps the signature stable for future extensions; consistent with the WS gateway's existing async context.

**Consequences:** All callers must `await` the result. Both `_runOnce` and `handleInputFrame` are already `async`, so no structural change is needed.

---

## Decision 3: Do not modify `agent_sessions_controller.create()`

**Problem:** The issue spec mentions `agent_sessions_controller.create()` as a "Broken (fix)" target. However, that path already goes through C1 role gating via `resolveMcpRole()` (an explicit role-slug lookup from `.mcp-roles/`). Adding `resolveProfileScope` there would be a second, potentially conflicting MCP config path.

**Decision:** Leave `agent_sessions_controller.create()` unchanged. Its role-file path is the right mechanism for the REST-created session path. `resolveProfileScope` is wired only into the WS auto-resume path (where `createSession` is called without any existing role config) and into `agent_runner._runOnce`.

**Consequences:** Sessions created via REST `POST /agent-sessions` with no `mcpRole` do not inherit the profile's `allowed_mcps_json` at create time. The WS gateway auto-resume path (first `session.input` after server restart) does pick it up. This is an acceptable gap for the current scope; a future PR could optionally also apply the profile scope at REST create time.
