---
date: 2026-08-26
repo: Rhythm
branch: fix/optimizer-scope-lane
pr: pending
issues: [1479, 1482]
status: ready-for-verification
tags: [run, Rhythm]
---

# Optimizer scope-lane correctness

## Files

- Added live MCP tool-catalog validation for profile writes, proposal applies, audit drift, and read-only reporting.
- Added a fork `/mcp/tools` endpoint backed by the connected servers' real `MCP.tools()` catalog.
- Unified audit activity and successful-use evidence around the same owned session IDs, with legacy `agent_kind` fallback.
- Made profile requirement matching case-insensitive, alias-aware, skill-aware, and explicit-tools-map-aware.
- Added acceptance contracts and tests for #1479 and #1482.

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

## Existing-row report

Read-only comparison against the issue's live Obsidian catalog found 16 phantom grants outside the now-repaired theologian row:

- `fantasy-gm`: `obsidian_put_file`, `obsidian_patch_file`
- `money`: `obsidian_get_file`, `obsidian_search_dataview`, `obsidian_status`
- `worship-production`: `obsidian_get_file`, `obsidian_put_file`, `obsidian_patch_file`, `obsidian_search_dataview`, `obsidian_status`
- `graphic-designer`: `obsidian_get_file`, `obsidian_search_dataview`, `obsidian_status`, `obsidian_list_vault_directory`, `obsidian_list_vault_root`, `obsidian_get_active`

The report was read-only; no live `agent_configs` rows were changed.

## Notes / handoff

- The shared dev sandbox was deliberately not started. Live fork endpoint and repair/report verification are deferred to the serial sandbox gate.
- GitNexus `detect_changes(scope=all)` was invoked before each commit attempt but unavailable during the concurrent index rebuild.
- Two commits only: one per issue. Draft PR creation follows after the second commit; do not merge.
