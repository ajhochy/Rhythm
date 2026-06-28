---
date: 2026-06-27
repo: Rhythm
branch: codex/fix-secretary-agent-scope
pr: "https://github.com/ajhochy/Rhythm/pull/771"
issues: ["#765"]
status: fixed
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# Issue #765 — Smoke Failure Root Cause & Deeper Fix

## Smoke Failure (2026-06-27 first smoke)

The initial smoke failed: Secretary session reported ALL MCP servers (Ableton,
Canva, NFL, ProPresenter, etc.) even after the ws_gateway per-turn scope fix
was committed and PR #771 was open.

## Root Cause of Smoke Failure

**Contract test passed but smoke failed because the test exercised a different
code path than the real app.**

The test: creates a session with no `sdk_session_id`, mocks `opencodeSessionMap`
as empty → ws_gateway takes the "create new SDK session" path → calls
`createSession(title, cwd, wsMcpRoleConfig)` → fork session is created WITH the
allowlist → filter fires correctly.

The real app: `POST /agent-sessions` creates the Rhythm session AND the opencode
SDK session immediately (via `createSession` with no profile, since the profile
isn't known yet). When the first WS message arrives with `agent: 'secretary'`,
`opencodeId` is already in `opencodeSessionMap` → the `if (!opencodeId)` block
is skipped entirely → `createSession` is never called with the allowlist → fork
session has `mcp_allowlist = NULL` → all tools visible.

Confirmed by querying the fork DB directly:
```bash
sqlite3 ~/.local/share/opencode/opencode-fix-issue-761-agents-ui-render.db \
  "SELECT id, mcp_allowlist FROM session ORDER BY time_created DESC LIMIT 1;"
# → ses_0f3e95ec3ffeQ6bGgyxtfjYMTs | NULL
```

Prior `PATCH /session/:id` with `{mcpAllowlist: {servers: ['rhythm']}}` returned
HTTP 200 but the DB was unchanged because `UpdatePayload` in the fork did not
include `mcpAllowlist` — the field was silently ignored.

## Files Changed (this follow-up commit)

| File | Change |
|---|---|
| `apps/opencode_fork/.../session.ts` | Export `McpAllowlist`; add `setMcpAllowlist` to Interface + layer |
| `apps/opencode_fork/.../groups/session.ts` | Add `mcpAllowlist` to `UpdatePayload` |
| `apps/opencode_fork/.../handlers/session.ts` | Handle `mcpAllowlist` in `update` handler |
| `apps/api_server/src/@types/opencode-ai-sdk.d.ts` | Declare `session.update()` method |
| `apps/api_server/src/services/opencode_client_service.ts` | Add `updateSessionAllowlist()` |
| `apps/api_server/src/services/ws_gateway.ts` | Call `updateSessionAllowlist` after scope resolution, for ALL session states |

## Checks After Fix

- `npx tsc --noEmit` → exit 0
- `npx vitest run` → 150 files, 1285 tests, all passed
- Fork binary rebuilt (`bun run build -- --skip-embed-web-ui`), darwin-arm64,
  copied to `apps/api_server/opencode_bin/opencode`
- Committed `40dc80761`, pushed to `codex/fix-secretary-agent-scope`

## Known Limitation

If the user switches from a restricted profile back to an unrestricted one
mid-session, the fork session retains the previously-set allowlist. This
is the same documented limitation from the initial PR — acceptable for the
current smoke criterion (first-turn scope enforcement, which is the real
app flow).

## Next Step

Re-run the manual smoke: launch the app against the new fork binary, send a
Secretary turn, confirm tool list is restricted to rhythm only.
