---
date: 2026-08-10
repo: Rhythm
branch: mega-ws/mcp-apps
pr: null
issues: [1355]
status: environment-blocked
tags: [run, Rhythm]
---

# Issue #1355 — dashboard MCP App pilot

## Files

- Added a separate trusted `registerAppTool` helper without changing the shared legacy registration path.
- Added a stable descriptor and self-contained `ui://rhythm/dashboard` resource to the existing `rhythm_get_dashboard` tool.
- Preserved the full scanned/fenced text fallback and added aggregate-only structured metrics so user-authored titles never bypass the untrusted fence.
- Updated dashboard/security contracts without changing `apps/mcp_server/src/index.ts` or the MCP tool count.

## Checks

- `cd apps/mcp_server && ./node_modules/.bin/vitest run src/tools/__tests__/issue_1355_dashboard_mcp_app.test.ts src/tools/__tests__/dashboard.test.ts src/security/__tests__/external_content_role_graph.test.ts` — PASS, 13 tests.
- `cd apps/mcp_server && npm run typecheck && npm run build` — PASS.
- `cd apps/desktop_flutter && dart --packages=.dart_tool/package_config.json tool/contracts/issue_1351_readonly_pilot.dart` — PASS.
- Full MCP suite — PARTIAL: five HTTP-listener tests are environment-blocked by `listen EPERM 127.0.0.1`.

## Notes

- Live/debug/packaged evidence for both pilots remains for the UI/socket-capable orchestrator.
- `off` remains inert through the existing generic host mode parser.
