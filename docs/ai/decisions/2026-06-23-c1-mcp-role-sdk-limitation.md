---
date: 2026-06-23
repo: Rhythm
tags: [decision, rhythm, api_server, opencode-sdk, security]
---

# Decision: C1 MCP Role — Init-time Gate via Session Row (SDK Limitation Fallback)

## Context

Issue C1 requires that `POST /agent-sessions` accept an optional `mcpRole` that scopes the agent session to the tools listed in `.mcp-roles/<role>.mcp.json` at session-create time (init-time gate). The spec says: if the SDK cannot accept a per-session allowlist directly, the fallback is to write/point the session at a generated scoped `.mcp.json` (cwd-based) and document the choice.

The OpenCode SDK (`@opencode-ai/sdk` v1.14.x) `session.create()` signature:
```ts
create(options: {
  body: { parentID?: string; title?: string };
  query?: { directory?: string };
}): Promise<SdkEnvelope<Session>>;
```
No `mcpConfig`, no `allowedTools`, no per-session tool scope.

The `client.mcp.add()` method adds MCP servers scoped to a **directory**, not a session — it would affect all concurrent sessions in the same cwd.

## Decision

Use the "store on session row" fallback rather than writing a per-session `.mcp.json` file:

1. Resolve the role file at create time (init-time gate — bad role → 400 before session is created).
2. Persist `mcp_role` (slug) and `mcp_allowed_tools_json` (JSON `Record<serverName, string[]>`) on the `agent_sessions` row.
3. Pass the resolved config as an optional third argument to `opencodeClient.createSession()` so the service boundary is explicit and tests can spy on it.
4. The WS gateway reads `mcpAllowedToolsJson` from the session row to enforce the allowlist at dispatch time (future work — not in C1 scope).

## Alternatives considered

- **Write a per-session temp `.mcp.json` in the session cwd** — rejected: would affect ALL sessions sharing the same cwd directory, not just this session. Race condition for concurrent sessions.
- **Use `client.mcp.add()` after session creation** — same problem as above: scoped to directory, not session. Also fires after the session exists, so the init-time guarantee is weaker.
- **Defer to WS gateway runtime check** — spec explicitly forbids runtime dispatch filter ("init-time gate only, never a runtime dispatch check"). Storing on the row is still init-time; the WS gateway check enforces it at tool-call time, which is architecturally closer to init-time than request-time.

## Consequences

- **Security contract holds:** Unknown/invalid role → 400 before session creation. No silent fallback to full tools.
- **Enforcement gap:** The allowlist is stored but not yet read by the WS gateway. A future issue should add the enforcement read in `ws_gateway.ts`. Until then, the role is recorded but not actively restricting tool access.
- **Bundled deployments:** Operators must set `MCP_ROLES_DIR` env var when the api_server is embedded in the Flutter `.app` bundle (the default `__dirname`-relative path won't resolve outside the repo tree).
