---
date: 2026-06-28
repo: Rhythm
branch: worktree-agent-a91a2b4a1a8a49ea9
pr: pending
issues: [807, 801]
status: verified-pending-pr
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# Run — #807 remove prod agent_memory store; memory is local-vault-only

Memory epic #801, issue 6/7. Based on `feature/mem-vault` (off #802–#806).
Maintainer-simplified scope: **START FRESH, no data migration** — remove the
prod cloud memory store from the code and redirect/document anything still
pointing at it. Effective next deploy; nothing breaks until then.

## Files changed

- `apps/api_server/src/database/postgres_bootstrap.ts` — removed the prod
  Postgres `CREATE TABLE agent_memory` + `idx_agent_memory_fts` /
  `idx_agent_memory_owner` indexes (was ~L544-559); replaced with a removal note.
  No FK/view referenced the table, so prod bootstrap stays clean.
- `apps/api_server/src/app.ts` — `/agent-memory` mount was ALREADY inside the
  `if (env.agentExecutionEnabled)` gate (cloud role omits it); added a comment
  documenting it is local-only, backed by the SQLite index over the
  Memory-Vault, not prod.
- `apps/api_server/src/database/migrations.ts` — updated the stale comment that
  claimed a non-disposable Postgres `agent_memory` exists; the SQLite index is
  now the only store. (SQLite CREATE unchanged — that's the local store.)
- `apps/api_server/src/repositories/agent_memory_repository.ts` +
  `services/memory_index_service.ts` — comment-only: note the Postgres store is
  removed; the remaining Postgres branches are inert dead paths.
- `apps/api_server/src/__tests__/issue_755_role_separation.test.ts` — re-pointed
  the #755 representative gated-table assertions from `agent_memory` to
  `agent_webhook_endpoints` (now the first gated table) and added a #807
  source-contract assertion that the bootstrap creates no `agent_memory`
  table/FTS/owner index.
- `docs/ai/decisions/2026-06-28-remove-prod-agent-memory-store.md` (new).

## Checks run

- `node_modules/.bin/tsc --noEmit` → exit 0.
- `npm run build` (tsc) → exit 0.
- Full `npx vitest run` → 1367 pass / 162 files (0 fail).
- Targeted: `agent_memory memory_injection memory_write_vault_first
  memory_index_rebuild memory_consolidation_seed opc_rhythm_mcp_ensure` → 42/42;
  `issue_755_role_separation` → 21/21.
- **Falsification** of the new #807 assertion: temporarily re-adding the prod
  `CREATE TABLE agent_memory` makes the assertion FAIL with the exact message
  (`postgres_bootstrap must NOT create a Postgres agent_memory table (#807)`);
  restored → green. Confirms the test is real evidence, not coverage.
- Repo scan `grep -rniE "agent_memory|/agent-memory" apps --include=*.ts
  --include=*.dart`: all live refs resolve to the LOCAL store — Flutter
  `agent_memory_data_source.dart` uses `AppConstants.agentLocalBaseUrl` (:4001);
  MCP `agentMemory.ts` uses the :4001 base (#804); SQLite migrations.ts + repo
  are the local index.

## Notes

- The `/agent-memory` route and the Postgres table were both already gated by
  `agentExecutionEnabled` (false only for `RHYTHM_ROLE=cloud`). But prod's
  default role is `all`, so the prod image WAS still creating the table — that
  was the unmigrated remnant #807 removes.
- Two Postgres branches remain in `agent_memory_repository.ts` (clearAll no-op,
  delete). Left as inert dead paths (prod never mounts the route; local server is
  SQLite) to keep the change minimal; could be deleted if a Postgres agent role
  is ever retired.
- **#808 (guards)** should assert: (a) `postgres_bootstrap.ts` creates no
  `agent_memory` table / `idx_agent_memory_*` index (source-contract assertion
  already seeded in `issue_755_role_separation.test.ts`); (b) no code path
  reads/writes agent memory against the prod base (Flutter + MCP both :4001);
  (c) the local SQLite store + `/agent-memory` route under the agent-execution
  gate remain intact.
- Not pushed (worktree subagent). When the orchestrator opens the PR for
  `feature/mem-vault`, the body should include `Closes #807`.
- Decision: [[2026-06-28-remove-prod-agent-memory-store]].
