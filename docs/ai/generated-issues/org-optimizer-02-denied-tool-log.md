# org-optimizer-02: Denied-tool event log

## Goal

Add a lightweight log of dispatch-time denied tool calls (which profile/session
was denied which tool, with counts) so the org audit can read "profile X was
denied tool Y N times" — the strongest signal for broaden-scope (gate) and
create-agent proposals.

## Context

`mcp_dispatch_guard.isToolAllowed(toolName, allowedToolsJson)` returns a boolean
at dispatch (Layer 2, #736). Today a denial is invisible to any later analysis.
The audit (org-optimizer-03) needs these denials as signals. Keep it minimal —
a small table or structured log, written on the deny branch only.

## Likely files

- `apps/api_server/src/services/mcp_dispatch_guard.ts` (write on the deny path)
- `apps/api_server/src/database/migrations.ts` (NEW `denied_tool_events` table, SQLite)
- NEW `apps/api_server/src/repositories/denied_tool_events_repository.ts`

## Acceptance Criteria

- [ ] `denied_tool_events` table (SQLite only) with at least: `id`,
  `session_id` (nullable), `agent_config_id` (nullable), `tool_name`,
  `created_at`. (Aggregation by count is a query, not a stored counter.)
- [ ] When `isToolAllowed(...)` returns `false` at dispatch, a row is written;
  when it returns `true`, no row is written.
- [ ] Writing is best-effort / never throws into the dispatch path (fail-open for
  logging, fail-closed for the guard itself — the guard's allow/deny decision is
  unchanged).
- [ ] Repository exposes `countByProfileAndToolAsync(sinceIso)` returning
  `{ agentConfigId, toolName, count }[]` for the audit.

## Required tests

- dispatch-guard logging contract: a denied call writes exactly one row with the
  sanitized tool name; an allowed call writes none; the allow/deny return value of
  `isToolAllowed` is unchanged by the logging.
- repo aggregation contract: `countByProfileAndToolAsync` groups + counts correctly
  within the window.

## Dependencies / order

No deps (independent of 01). Required by org-optimizer-03.

## Safety notes

Local SQLite only. The guard's security decision must not regress — logging is
additive and must not change `isToolAllowed`'s return or throw.
