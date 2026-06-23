---
index: "[[Rhythm]]"
date: 2026-06-23
repo: Rhythm
branch: feature/agent-scheduler
pr: (not yet opened)
issues: C1
status: verified-headless
tags: [run, rhythm, api_server]
---

# Run: C1 — MCP Role Session Gating

## Files changed

| File | Change |
|------|--------|
| `apps/api_server/src/models/agent_session.ts` | Added `mcpRole: string \| null` and `mcpAllowedToolsJson: string \| null` to `AgentSession`; added same optional fields to `CreateAgentSessionDto` |
| `apps/api_server/src/database/migrations.ts` | Additive `ALTER TABLE agent_sessions ADD COLUMN mcp_role TEXT` + `mcp_allowed_tools_json TEXT` (guarded by column-presence check) |
| `apps/api_server/src/repositories/agent_sessions_repository.ts` | Updated `AgentSessionRow`, `rowToModel()`, and `insert()` to persist/read the new columns |
| `apps/api_server/src/services/opencode_client_service.ts` | Extended `createSession(title, directory?, mcpRoleConfig?)` signature — third arg is passed through and logged; not forwarded to SDK (limitation documented) |
| `apps/api_server/src/controllers/agent_sessions_controller.ts` | Added `path`/`fs` imports; `MCP_ROLES_DIR` constant (env-var override); `resolveMcpRole()` helper with slug validation + path-traversal guard; `mcpRole` parsing and resolution block in `create()` |
| `apps/api_server/src/__tests__/agent_sessions_mcp_role.test.ts` | NEW — 8 contract tests: (a) valid role → allowlist on row + passed to SDK, (b) unknown role → 400, (c1–c3) path-traversal variants → 400, (d) no role → unchanged behavior, (d2) null → same as absent, (e) non-string → 400 |
| `apps/api_server/src/__tests__/agent_sessions.test.ts` | Updated 2 existing `createSession` call assertions: `toHaveBeenCalledWith(name, cwd)` → `toHaveBeenCalledWith(name, cwd, undefined)` to reflect new optional third arg |

## Checks run

| Check | Result |
|-------|--------|
| `node_modules/.bin/tsc --noEmit` | ✅ 0 errors |
| `npm test` (vitest run) | ✅ 917/917 passed, 105/105 files |

## Decisions

1. **SDK does not support per-session tool allowlist.** `session.create()` in `@opencode-ai/sdk` accepts only `{ title, directory }`. The accepted fallback (per issue C1 "Ambiguity flag for reviewer") is to store the allowlist on the session row and pass it through `createSession()` as a typed argument so it can be spied on in tests. WS gateway enforcement is deferred to a future issue. Documented in a block comment in `opencode_client_service.ts`.

2. **`MCP_ROLES_DIR` env-var override.** The Flutter `.app` bundle embeds the api_server at `$resourcesDir/api_server/` without the full repo tree. The default `__dirname`-relative path won't resolve in production. Override via `MCP_ROLES_DIR` env var.

3. **Slug validation: `[a-z0-9-]+` only.** Rejects `.`, `/`, `..` at the regex layer before any filesystem call. Defense-in-depth path escape check added after for extra safety.

See `docs/ai/decisions/2026-06-23-c1-mcp-role-sdk-limitation.md` for the SDK limitation decision.

## Notes

- No Flutter changes in this run (pure api_server).
- Postgres bootstrap (`postgres_bootstrap.ts`) not updated — the C1 columns are only needed locally (agent sessions are local-only, not synced to prod Postgres). If a future migration adds them to prod, `postgres_bootstrap.ts` must be updated then.
- Pre-existing 2 failures in `new_session_dialog_error_test.dart` unchanged.
