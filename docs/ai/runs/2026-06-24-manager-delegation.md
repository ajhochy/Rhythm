---
date: 2026-06-24
repo: Rhythm
branch: feature/agent-scheduler
pr: 734
issues: [P4-D1, P4-D2, P4-D3, P4-D4, P4-D5]
status: implemented
tags: [run, Rhythm]
---

# Manager Delegation

## Files

- `docs/ai/generated-issues/P4-2-manager-delegation-issues.md` plus `D1`-`D5` generated issue files: split the epic tracker into implementation-sized local issues.
- `docs/ai/contracts/issue-P4-manager-delegation.json`: executable acceptance contract for D1-D5.
- `apps/api_server/src/database/migrations.ts`, `apps/api_server/src/database/postgres_bootstrap.ts`: additive `allowed_delegates_json` schema.
- `apps/api_server/src/repositories/agent_configs_repository.ts`, `apps/api_server/src/controllers/agent_configs_controller.ts`: repository/API field support.
- `apps/api_server/src/services/agent_delegation_service.ts`, `controllers/agent_delegation_controller.ts`, `routes/agent_delegation_routes.ts`, `app.ts`: local delegation API and authorization/depth guards.
- `apps/api_server/src/services/agent_profile_sync.ts`: importer-driven `workflow-orchestrator` manager flag and delegate allowlist.
- `apps/mcp_server/src/tools/agentDelegation.ts`, `apps/mcp_server/src/index.ts`: `rhythm_delegate` MCP tool.
- `apps/desktop_flutter/lib/features/agent_configs/models/agent_config.dart`, `apps/desktop_flutter/lib/features/agents/views/_agent_profile_sheet.dart`: Flutter model and manager delegate editor.
- Tests added/updated across API, MCP, and Flutter focused suites.

## Checks

- PASS: `cd apps/api_server && npx vitest run src/__tests__/agent_configs.test.ts src/repositories/agent_configs_repository.test.ts src/__tests__/agent_delegation_auth.test.ts src/__tests__/agent_profile_sync_hygiene.test.ts`
- PASS: `cd apps/mcp_server && npx vitest run src/tools/agentDelegation.test.ts`
- PASS: `cd apps/api_server && npx tsc --noEmit`
- PASS: `cd apps/mcp_server && npm run typecheck`
- PASS: `cd apps/desktop_flutter && flutter test test/features/agents/agent_profile_model_picker_test.dart`
- PASS: `cd apps/desktop_flutter && flutter analyze --no-fatal-infos` (info-level existing lints)
- PASS: `ai-workflow checks --level issue`
- PASS: `cd apps/api_server && npx vitest run` (140 files, 1184 tests)
- PASS: `node .gitnexus/run.cjs detect-changes --repo Rhythm --scope unstaged` (medium risk)
- PASS with expected branch-wide warning: `node .gitnexus/run.cjs detect-changes --repo Rhythm --scope compare --base-ref main` (critical because the branch has large unrelated prior work)

## Notes

- Delegated sub-runs call `AgentRunner.run` with `agentConfigId` and `agentKind` set to the target profile id. That reuses the existing target-profile `resolveProfileScope` path instead of creating a second scope resolver.
- Delegation depth is capped at one layer: direct manager calls use `depth: 0`; calls with `depth >= 1` are rejected.
- The MCP/API boundary currently relies on the caller profile id supplied in the tool request, then authorizes that profile from local DB state. A future hardening pass can bind the tool request to the active session profile if/when that identity is available to MCP tools.

## Smoke Update

- PASS: launched `apps/api_server/dist/server.js` on `localhost:4001` with `AGENT_LOCAL=true` and isolated DB `/tmp/rhythm-p4-smoke.db`.
- PASS: `/health`, `/opencode/health`, and `/agents/capabilities`.
- PASS: `POST /agent-configs/sync-opencode` imported 16 profiles; `workflow-orchestrator` was manager with 12 delegates, including `coding-agent` and excluding itself.
- PASS: live HTTP guard checks for non-manager, unlisted target, self-delegation, and `depth: 1`.
- PASS: launched Flutter macOS app with `RHYTHM_LOCAL_SMOKE=1`; screenshot captured at `/tmp/rhythm-p4-app-smoke.png`.
- PASS: retesting against the currently running live app server after importer sync returned HTTP 200 for `workflow-orchestrator` → `coding-agent` with output `SMOKE_DELEGATION_OK`; final delegated session `109d12ce-af84-4265-b99a-f98401b98a60` was `idle`.
