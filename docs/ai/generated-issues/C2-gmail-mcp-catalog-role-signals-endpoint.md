# C2 — Gmail MCP server in catalog + `email-assistant` role + signals endpoint

**Labels:** `feature`, `api-server`, `security`, `phase-c`
**Depends on:** — (C1 is a dependency for the launch flow in C3, not this issue)

## Context

The Email feature needs three backend pieces: (1) a version-pinned gmail MCP server entry in the curated catalog, (2) an `email-assistant` MCP role file scoping gmail + rhythm tools, and (3) an HTTP endpoint that exposes `gmail_signals_repository.listRecentAsync()` (already implemented in the repository but not yet reachable over HTTP).

## Likely files

- `apps/api_server/src/config/curated_mcp_servers.ts` (add version-pinned gmail MCP entry)
- NEW `.mcp-roles/email-assistant.mcp.json`
- NEW `apps/api_server/src/routes/gmail_signals_routes.ts`
- NEW `apps/api_server/src/controllers/gmailSignalsController.ts` (or inline in the routes file)
- `apps/api_server/src/app.ts` (register the new route)
- `apps/api_server/src/repositories/gmail_signals_repository.ts` (read-only — already has `listRecentAsync`)

## Acceptance criteria

- [ ] `curated_mcp_servers.ts` contains a new entry for the gmail MCP server with a fully version-pinned `command` (e.g., `npx @some-org/gmail-mcp@1.2.3` — exact package and version verified to exist on npm before merge; see safety note).
- [ ] `.mcp-roles/email-assistant.mcp.json` mirrors the shape of `.mcp-roles/church-admin.mcp.json`: `mcpServers` lists `gmail` and `rhythm`; each entry has a scoped `allowedTools` array; `disabledMcpServers` includes `["bash", "computer", "editor", "filesystem"]`.
- [ ] `GET /integrations/gmail-signals` (or `GET /agent-email/signals` — pick the path that fits `app.ts` route grouping) calls `gmail_signals_repository.listRecentAsync(ownerId, 12)` and returns the array.
- [ ] The endpoint returns `[]` (not 500) when there are no signals for the owner.
- [ ] The endpoint returns 401 when the request is unauthenticated.
- [ ] Role JSON validates against the shape of existing `.mcp-roles/*.mcp.json` files (all required keys present, `disabledMcpServers` non-empty).
- [ ] `tsc --noEmit` reports zero type errors.

## Gmail pin verification (CRITICAL — safety note)

Per "Known Ambiguities — Gmail MCP package pin": the exact gmail MCP server package/command is unverified. Before merge, the implementer MUST:
1. Confirm the npm package name and version exist (`npm view <package>@<version>` returns data).
2. Pin to that exact version in `curated_mcp_servers.ts`.
3. Add a comment in the file: `// verified: npm view <package>@<version> 2026-MM-DD`.

Do NOT ship an unpinned `npx` spec (e.g., `npx @foo/gmail-mcp` without `@version`).

## Required validation commands

```bash
cd apps/api_server && node_modules/.bin/tsc --noEmit && npm test
```

New tests in `apps/api_server/src/__tests__/gmail_signals.test.ts`:
- `GET /integrations/gmail-signals` returns `[]` on empty DB.
- Returns recent signals when records exist.
- Returns 401 when unauthenticated.

## Security notes

- The `email-assistant` role MUST include `disabledMcpServers: ["bash", "computer", "editor", "filesystem"]` — agentic Email gets ONLY its scoped MCP tools.
- No per-request LLM endpoint override in the signals route.

## Data-safety out-of-scope

No Flutter changes in this issue. No new database tables (gmail_signals table already exists).
