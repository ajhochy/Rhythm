---
date: 2026-08-26
repo: Rhythm
branch: fix/optimizer-scope-lane
pr: pending
issues: [1479, 1482]
status: awaiting-sandbox-verification
tags: [run, Rhythm]
---

# Optimizer scope-lane correctness

## Files

- Added live MCP tool-catalog validation for profile writes, proposal applies, audit drift, and read-only reporting.
- Added a fork `/mcp/tools` endpoint backed by the connected servers' real `MCP.tools()` catalog.
- Unified audit activity and successful-use evidence around the same owned session IDs, with legacy `agent_kind` fallback.
- Made profile requirement matching case-insensitive, alias-aware, skill-aware, and explicit-tools-map-aware.
- Added acceptance contracts and tests for #1479 and #1482.
- Added one serial env-gated live suite for real engine catalog, API write/apply
  rejection, operator drift reporting, optimizer false-positive controls, and
  exact scope count/SHA-256 non-mutation evidence.
- Added the read-only `rhythm mcp-tool-grant-drift` operator command. It requires
  an explicit SQLite `DB_PATH` and loopback fork URL, opens the DB read-only,
  emits only `{profileId, serverName, toolName}`, and exits nonzero on validation
  failure.
- Repaired `GET /opencode/mcp` tool grouping to consume the MCP-only `/mcp/tools`
  catalog instead of the built-in/plugin tool catalog.

## Checks

- RED #1479: `cd apps/api_server && npx vitest run src/__tests__/issue_1479_contract.test.ts` — 3/3 failed on missing PATCH/apply validation, tool drift, and report pass.
- GREEN #1479: same command — 3/3 passed.
- #1479 regressions: `npx vitest run src/services/__tests__/org_audit_service.test.ts src/services/__tests__/org_proposal_appliers_wiring.test.ts src/__tests__/agent_configs_routes.test.ts` — 80/80 passed.
- RED #1482: `npx vitest run src/__tests__/issue_1482_contract.test.ts` — 3/3 failed on agentKind attribution, prompt aliases, and skills/tools-map intent.
- GREEN #1482 + regressions: `npx vitest run src/__tests__/issue_1482_contract.test.ts src/services/__tests__/org_exercised_tools_resolver.test.ts src/__tests__/scope_hygiene_generator.test.ts src/services/__tests__/org_audit_service.test.ts` — 72/72 passed.
- Combined: `npx vitest run src/__tests__/issue_1479_contract.test.ts src/__tests__/issue_1482_contract.test.ts src/__tests__/org_optimizer_scope_false_positives.test.ts` — 21/21 passed.
- `cd apps/api_server && npx tsc --noEmit` — exit 0.
- Fork monorepo `bun run typecheck` could not complete because the existing linked dependency tree lacks `@tsconfig/node22`; package-only typecheck likewise reports broad pre-existing missing workspace dependencies. No sandbox/build was run.
- GitNexus impact: initial file fallbacks for #1479 were LOW (0 direct/processes). Later symbol calls and both detect-changes gates were unavailable because another process was rebuilding an incompatible LadybugDB index; no HIGH/CRITICAL result was returned.

### Coverage/completeness repair

- RED parser/CLI: `npx vitest run src/__tests__/scope_hygiene_generator.test.ts src/cli/mcp_tool_grant_drift.test.ts` — parser emitted zero proposals for real `scopeKind=mcp-tool ... serverName=...` evidence; CLI was an unknown command. 3 contract assertions failed.
- GREEN parser/CLI: same command — 10/10 passed. The parser preserves existing mcp/skill behavior and now routes mcp-tool evidence to `allowedMcpsJson`; the CLI report is sanitized/read-only and validation failures are nonzero.
- Exact prior focused commands rerun: 3/3, 80/80, 73/73 (the prior 72 plus the new mcp-tool parser contract), and 21/21 passed. CLI adds 2/2, for 179 passing invocations total (176 prior baseline + 1 parser + 2 CLI).
- Live file with flags absent: 2/2 skipped cleanly.
- Forced live file without isolation: failed closed in `assertLiveE2EIsolation` before either case ran.
- `npm run build && npx tsc --noEmit` — exit 0.
- `git diff --check` — exit 0.
- GitNexus impact and `detect_changes(scope=all)` were attempted again; both remain unavailable with LadybugDB file v42/client storage v41, risk UNKNOWN (not HIGH/CRITICAL).
- Sandbox live command was deliberately **not run** because S2 owns the sole sandbox. Both issue contracts are `UNVERIFIED`/`not_tested` until that command passes against API `4098`, engine `4097`, and the exact sandbox DB path.

### Product wiring repair after live failure

- RED route contract: `npx vitest run src/__tests__/opc_m4_3_mcp_routes.test.ts` — 1 failed, 19 passed; the API returned `tools: []` because it called `listToolIds()` rather than the separately populated MCP catalog.
- GREEN route contract: same command — 20/20 passed; the contract asserts grouped composed IDs and that `listMcpToolIds()` is called while `listToolIds()` is not.
- Exact S3 focused baseline rerun: 3/3, 80/80, 73/73, 21/21, and CLI 2/2 — 179 passing invocations. With the route suite, 199 passing invocations total.
- `npm run build && npx tsc --noEmit` — exit 0.
- Live suite with flags absent — 2/2 skipped cleanly. Forced live suite without isolation — failed closed in `assertLiveE2EIsolation`; no server or sandbox command was run.
- No deterministic fixture was added: this S3 repair is the one-line product wiring defect found by S4's real sandbox run; S4 retains ownership of the sandbox and live rerun.
- GitNexus route/symbol impact was retried before the product edit and remained unavailable with LadybugDB file v42/client storage v41; risk UNKNOWN and no HIGH/CRITICAL result.

## Existing-row report

Read-only comparison against the issue's live Obsidian catalog found 16 phantom grants outside the now-repaired theologian row:

- `fantasy-gm`: `obsidian_put_file`, `obsidian_patch_file`
- `money`: `obsidian_get_file`, `obsidian_search_dataview`, `obsidian_status`
- `worship-production`: `obsidian_get_file`, `obsidian_put_file`, `obsidian_patch_file`, `obsidian_search_dataview`, `obsidian_status`
- `graphic-designer`: `obsidian_get_file`, `obsidian_search_dataview`, `obsidian_status`, `obsidian_list_vault_directory`, `obsidian_list_vault_root`, `obsidian_get_active`

The report was read-only; no live `agent_configs` rows were changed.

## Notes / handoff

- The shared dev sandbox was deliberately not started or touched. Live fork endpoint and repair/report verification are deferred to the serial sandbox gate.
- GitNexus `detect_changes(scope=all)` was invoked before each commit attempt but unavailable during the concurrent index rebuild.
- This repair adds focused commits after the two issue commits. No push or PR was performed.
