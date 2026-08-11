---
date: 2026-08-10
repo: Rhythm
branch: mega-ws/mcp-apps
pr: null
issues: [1345]
status: partial
tags: [run, Rhythm]
---

# Issue #1345 — session-bound MCP App resource reads

## Files

- Added persisted completed-tool provenance and a fail-closed resource policy/route in the fork.
- Regenerated the fork OpenAPI and v2 SDK, synchronized the legacy generated SDK, and refreshed the api_server vendored artifact.
- Added the owned api_server session route/controller/typed SDK wrapper and the fixed-localhost Flutter data-source call.
- Added contract tests plus an env-gated live sandbox test.

## Checks

- `cd apps/opencode_fork/packages/opencode && bun test test/session/issue_1345_mcp_app_resource_contract.test.ts test/mcp/issue_1352_mcp_apps_contract.test.ts` — PASS, 9 tests / 66 assertions.
- `cd apps/opencode_fork/packages/opencode && bun run typecheck` — PASS.
- `cd apps/opencode_fork/packages/sdk/js && bun run build:rhythm` — PASS; OpenAPI/v2 generation and vendored artifact refresh completed.
- `cd apps/opencode_fork/packages/sdk/js && bun run typecheck` — PASS.
- `cd apps/api_server && ./node_modules/.bin/vitest run src/__tests__/issue_1345_mcp_app_resource.test.ts src/__tests__/issue_1345_mcp_app_resource_live.test.ts` — PASS, 2 contract tests; live test skipped without `RHYTHM_LIVE_E2E=1`.
- `cd apps/api_server && ./node_modules/.bin/tsc --noEmit` — PASS.
- `cd apps/api_server && ./node_modules/.bin/vitest run src/__tests__/opc_agent_session_routes.test.ts src/__tests__/opencode_client_service.test.ts src/__tests__/opc_sdk_boundary_regression.test.ts` — PARTIAL: 21 tests passed; route suite could not bind `127.0.0.1` (`EPERM`) and timed out before assertions.
- Flutter changed-file dart_style check — PASS, 2 files / 0 changes.
- Flutter analyze with the workspace-safe temporary SDK/cache — PASS, 296 pre-existing infos.
- Focused Flutter test — BLOCKED before assertions because flutter_tester could not bind `127.0.0.1:0` (`EPERM`).
- `git diff --check` — PASS.
- GitNexus `detect-changes --scope all` — MEDIUM; 21 indexed files / 31 symbols, one existing Build → Connect flow.

## Notes

- The public route accepts only local session and tool-call path IDs. Server, URI, and cwd are derived internally; public query fields are rejected.
- Live isolated-sandbox evidence remains for the socket-capable orchestrator, per `.mega-task/BRIEF.md`.
