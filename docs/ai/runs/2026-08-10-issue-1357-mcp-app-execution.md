---
date: 2026-08-10
repo: Rhythm
branch: mega-ws/mcp-apps
pr: null
issues: [1357]
status: partial
tags: [run, Rhythm]
---

# Issue #1357 — same-server interactive MCP App execution

## Files

- Added the fork-owned HMAC proof gate, proof/execution HTTP endpoints, current app-tool/schema/profile checks, existing permission service and plugin hooks, and exact trusted MCP security context.
- Regenerated the v2 SDK and refreshed the api_server vendored artifact.
- Extended the API capability broker to retain the proof only in process and forward structured results only through the consuming one-use capability response.
- Allowed the validated `tools/call` method through the existing bounded Flutter transport without exposing proof/server/resource authority.
- Added focused fork/API/Flutter contracts and an env-gated approved/denied/cross-server live matrix.

## Checks

- `cd apps/opencode_fork/packages/opencode && bun run typecheck` — PASS.
- `cd apps/opencode_fork/packages/opencode && bun test test/session/issue_1357_mcp_app_execution_gate.test.ts test/session/issue_1345_mcp_app_resource_contract.test.ts test/mcp/issue_1352_mcp_apps_contract.test.ts` — PASS, 11 tests / 93 assertions, including approval denial before MCP execution.
- `cd apps/opencode_fork/packages/sdk/js && bun run build:rhythm` — PASS; OpenAPI/v2 SDK and vendored artifact refreshed.
- `cd apps/api_server && ./node_modules/.bin/tsc --noEmit` — PASS.
- `cd apps/api_server && ./node_modules/.bin/vitest run src/__tests__/issue_1357_mcp_app_execution.test.ts src/__tests__/issue_1357_mcp_app_execution_live.test.ts src/__tests__/issue_1353_mcp_app_capability_broker.test.ts` — PASS, 4 tests; live matrix skipped without `RHYTHM_LIVE_E2E=1`.
- `cd apps/desktop_flutter && dart --packages=.dart_tool/package_config.json tool/contracts/issue_1357_interactive_transport.dart` — PASS.
- `git diff --check` — PASS.

## Notes

- Proof is consumed before hooks, permission prompting, or MCP I/O, so replay creates zero additional prompts or tool calls.
- Live isolated sandbox and packaged/debug approval smoke remain for the socket/UI-capable orchestrator, as required by `.mega-task/BRIEF.md`.
