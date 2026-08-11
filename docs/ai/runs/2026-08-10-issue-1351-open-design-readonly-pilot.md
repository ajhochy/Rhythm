---
date: 2026-08-10
repo: Rhythm
branch: mega-ws/mcp-apps
pr: null
issues: [1351]
status: environment-blocked
tags: [run, Rhythm]
---

# Issue #1351 — read-only MCP App pilot

## Files

- Added the generic Dart read-only lifecycle/resource host and shipping WebView surface.
- Parsed engine-owned MCP App provenance into completed Flutter tool parts.
- Activated the host from the generic tool card only in canonical `readonly` mode.
- Added focused pure-Dart/widget contracts and an env-gated real sandbox test.

## Checks

- `dart --packages=.dart_tool/package_config.json tool/contracts/issue_1351_readonly_pilot.dart` — **PASS**, `issue-1351 contract PASS`.
- `bun test test/session/issue_1345_mcp_app_resource_contract.test.ts test/mcp/issue_1352_mcp_apps_contract.test.ts` — **PASS**, 9 tests / 66 assertions.
- `npx vitest run src/__tests__/issue_1351_open_design_live.test.ts` — **PASS (skipped by env gate)**, 1 skipped.
- `./node_modules/.bin/tsc --noEmit` — **PASS**.
- `flutter analyze --no-pub --no-fatal-infos` — **PASS**, 296 pre-existing infos.
- `flutter test --no-pub test/features/agents/issue_1351_mcp_app_readonly_pilot_test.dart` — **BLOCKED before assertions**: the managed sandbox denied `127.0.0.1:0` with `EPERM`.

## Notes

- The iframe receives no API token, server name, resource URI, or MCP transport. Flutter fetches only by local session/call through `localhost:4001`.
- App-originated methods other than ping deny deterministically; links/navigation are prevented and there is no mutation callback in the production path.
- Review caught and fixed a nonce-forging defect in the initial shell draft: child payloads are now forwarded unchanged, so stale or absent nonces cannot be upgraded by the host. Lifecycle delivery is wired after shell load.
- A UI/socket-capable orchestrator must run the env-gated Open Design test and both Debug and packaged Release smoke: confirm render, initialize/input/result/theme/size/ping/teardown, preserved fallback on resource failure, and a denied mutation/link with unchanged state.
