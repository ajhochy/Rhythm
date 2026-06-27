# C1 — Interactive sessions: add `mcpRole` (init-time MCP tool gating)

**Labels:** `feature`, `api-server`, `security`, `phase-c`
**Depends on:** —

## Context

Currently `POST /agent-sessions` has no role parameter — all interactive sessions get the full tool set. For Email (C3) and Gallery (D2) to launch agents scoped to only their MCP tools, this issue adds `mcpRole?` to the session-create DTO. At create time, the server resolves `.mcp-roles/<role>.mcp.json`, extracts `mcpServers`/`allowedTools`, and passes that allowlist to the SDK session (init-time gate). An unknown or missing role file returns 400 — no silent fallback to full tools.

## Likely files

- `apps/api_server/src/models/agent_session.ts` (add `mcpRole?: string` to the create DTO interface)
- `apps/api_server/src/controllers/agent_sessions_controller.ts` (`create()` method — resolve role + pass allowlist)
- `apps/api_server/src/services/opencode_client_service.ts` and/or `apps/api_server/src/services/opencode_engine.ts` (pass `allowedTools`/`mcpServers` to SDK session init)
- `.mcp-roles/*.mcp.json` (read-only during this issue — the existing role files are the shape reference, NOT modified here)

## Acceptance criteria

- [ ] `POST /agent-sessions` body accepts an optional `mcpRole` string field.
- [ ] When `mcpRole` is provided: the server reads `.mcp-roles/<mcpRole>.mcp.json`; extracts `mcpServers` and `allowedTools`; passes them to the SDK session at init time (init-time gate only — no runtime dispatch filtering).
- [ ] When `mcpRole` references a file that does not exist, the endpoint returns HTTP 400 with a descriptive error (e.g., `{ "error": "Unknown mcpRole: <name>" }`). No silent fallback to full tools.
- [ ] When `mcpRole` is absent/undefined, the endpoint behaves exactly as before (no regression).
- [ ] The allowlist is applied at session creation, not checked on every tool call.
- [ ] `tsc --noEmit` reports zero type errors.

## Ambiguity flag for reviewer

Per "Known Ambiguities — C1 (role application depth)": if the SDK cannot accept a per-session tool allowlist at init time, the fallback is to generate a per-session `.mcp.json` file in a temp directory and pass it as the session cwd config. Document which path was taken in a code comment. Surface to the reviewer if the fallback was used.

## Required validation commands

```bash
cd apps/api_server && node_modules/.bin/tsc --noEmit && npm test
```

New tests in `apps/api_server/src/__tests__/agent_sessions_mcp_role.test.ts`:
- Known role resolves → allowlist passed to SDK init (mock the SDK client, assert the allowlist argument).
- Unknown role → HTTP 400.
- No role → session created with existing behavior (no extra SDK args).

## Security notes (CRITICAL)

- **Init-time gate only** — no runtime dispatch check. This is the architectural requirement per security constraint "Tool gating is init-time via `.mcp.json` role scoping, never a runtime dispatch check."
- **No silent fallback** — unknown role MUST 400. A silent fallback to full tools would defeat the scoping purpose.
- `mcpRole` is a path component used to read a file. Validate that the resolved path stays within the `.mcp-roles/` directory (prevent path traversal: reject any `mcpRole` containing `..` or `/`).

## Data-safety out-of-scope

No Flutter changes in this issue. No new database tables.
