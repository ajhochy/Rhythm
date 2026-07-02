---
date: 2026-07-02
repo: Rhythm
branch: issue-818-denied-tool-log
pr: null
issues: [818]
status: complete
tags: [run, Rhythm]
---

## Files

- `apps/api_server/src/database/migrations.ts` — appended a new
  `denied_tool_events` table block (id, session_id nullable, agent_config_id
  nullable, tool_name NOT NULL, created_at) plus two indexes, at the end of
  `runMigrations()`. SQLite-only by construction.
- `apps/api_server/src/services/opencode_stream_bridge.ts` — added a
  `deniedToolEventsRepo` field; wired best-effort logging into the deny
  branch of the existing `isToolAllowedForSession` private method (single
  choke point for both dispatch call sites). Logging is wrapped in try/catch
  plus an async `.catch()` so it can never throw into the caller or change
  the returned boolean.
- NEW `apps/api_server/src/repositories/denied_tool_events_repository.ts` —
  SQLite-only repository: `recordAsync`, `listAllAsync`,
  `countByProfileAndToolAsync(sinceIso)` (real SQL `GROUP BY`, excludes null
  `agent_config_id`). No-ops on Postgres.
- NEW `apps/api_server/src/repositories/denied_tool_events_repository.test.ts`
  — contract tests for table shape (c1) and aggregation (c4).
- NEW `apps/api_server/src/__tests__/issue_818_contract.test.ts` — contract
  tests for exactly-one-row-on-deny/none-on-allow + no payload leakage (c2)
  and guard-decision-unchanged + throwing-logger-safety (c3), driving the
  real `OpencodeStreamBridge._relayEvent` with only the WS broadcast sink and
  opencode SDK client faked (mirrors `issue_736_contract.test.ts`'s pattern).
- NOT touched: `apps/api_server/src/services/mcp_dispatch_guard.ts` — `isToolAllowed`
  is a pure predicate with no I/O; confirmed it needed zero changes.
- `docs/ai/contracts/issue-818.json` — contract, all automated criteria
  updated to `status: pass`.

## Checks

- Contract tests confirmed FAILING before implementation:
  `cd apps/api_server && npx vitest run denied_tool_events_repository issue_818_contract`
  → 2 suites failed (`Cannot find module ... denied_tool_events_repository`).
- Same command after implementation → 2 files / 10 tests passed.
- `npx vitest run denied_tool mcp_dispatch_guard mcp_allowlist_expander opencode_stream_bridge issue_736_contract`
  → 5 files / 43 tests passed.
- `node_modules/.bin/tsc --noEmit -p tsconfig.json` → exit 0.
- Full `npx vitest run` → 179 files / 1530 tests passed.
- `grep -n denied_tool_events src/database/postgres_bootstrap.ts` → no matches
  (criterion c5).
- Falsification 1 (log-on-allow regression): changed `if (!allowed)` to
  `if (true)` → `issue-818-c2: an allowed tool-call writes no denied_tool_events row`
  failed (`expected length 0 but got 2`). Reverted; re-confirmed green.
- Falsification 2 (unsafe logger regression): replaced the guarded
  `recordAsync` call with an unguarded call to a non-existent method →
  `issue-818-c3: a throwing logger/repository does not affect the guard
  decision or crash dispatch` failed (`TypeError: ... is not a function`
  propagated out of `_relayEvent`). Reverted; re-confirmed green.

## Notes

- Logging seam: `OpencodeStreamBridge.isToolAllowedForSession`, not
  `isToolAllowed`. The guard predicate is pure and used directly by its own
  unit tests with literal JSON strings; adding I/O there would break both its
  purity contract and its test suite's assumptions. The bridge method already
  resolves the session row and is the single call site both dispatch paths
  (tool-part, permission-ask) route through.
- `agent_config_id` is always `null` from this seam today: `AgentSession` has
  no `agentConfigId` field (only `mcpRole` / `mcpAllowedToolsJson`). Matches
  the issue's design note; out of scope to thread real attribution through.
- One test bug found and fixed during implementation: a stray `sessionMap`
  entry from an earlier `seedSession()` call in the "throwing logger" test
  collided with a second session mapped to the same fake SDK session id;
  fixed by clearing `sessionMap` before re-seeding against the poisoned DB.
- Residual risk: fire-and-forget async logging is not awaited, so it can in
  theory race with process exit and lose the very last denial event before
  shutdown. Acceptable per the issue's explicit "best-effort" /
  never-throws-into-dispatch requirement — the org audit reads aggregate
  trends over a time window, not exact real-time counts.
- Branch pushed to `origin/issue-818-denied-tool-log`. No PR opened per
  instructions.

## Follow-up (same day): resolve agent_config_id at deny-log time

- Maintainer-approved follow-up, second commit on the same branch.
- Linkage found: `agent_sessions.agent_kind` is a logical FK to
  `agent_configs.id` (schema comment + agent_runner "agentKind IS the
  agent_configs id"); on the #765 interactive path `agent_sessions.mcp_role`
  carries the ENFORCING profile's agent_configs id (ws_gateway `setMcpScope`
  persists `mcpRoleConfig.role` = `perTurnAgent ?? agentKind`). Legacy paths
  may store non-profile `.mcp-roles` slugs in mcp_role.
- New `_resolveDeniedAgentConfigId(session)` in the bridge: try mcpRole then
  agentKind, validate each against a real `agent_configs` row via
  `AgentConfigsRepository.getById`, null on no-match or any error (swallowed;
  never throws into dispatch; guard decision unchanged).
- Tests: +4 attribution contract tests (known profile → id written; agent_kind
  fallback; unresolvable → null; end-to-end aggregation grouping); the
  throwing-logger test now also drops `agent_configs` (throwing resolver).
- Checks: contract 14 passed; regression set 43 passed; tsc exit 0; full suite
  1534 passed (twice consecutively; one earlier run showed the known
  parallel-isolation flake in unrelated files).
- Falsification: resolver forced to null → 3 attribution tests failed,
  null-case still passed; restored, green.
