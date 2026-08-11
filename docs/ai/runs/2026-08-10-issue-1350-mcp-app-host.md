---
date: 2026-08-10
repo: Rhythm
branch: mega-ws/mcp-apps
pr: null
issues: [1350]
status: environment-blocked
tags: [run, rhythm]
---

# Issue #1350 trusted MCP App host

## Files

- Added the production Swift shell/WebKit policy and registered it in Runner.
- Added the Dart bounded view/message lifecycle authority.
- Added native and Flutter contracts plus an opt-in valid/malicious fixture.

## Checks

- `node --test apps/desktop_flutter/macos/RunnerTests/issue_1350_mcp_app_host_contract.test.mjs` — PASS, 4/4.
- Standalone `swiftc` fixture in `-D DEBUG` and `-O`, followed by valid and malicious runs with `RHYTHM_MCP_APPS_MODE=readonly` — PASS in both builds; valid accepted, malicious denied `invalid_origin`, nonce redacted.
- Disabled fixture without `RHYTHM_MCP_APP_HOST_FIXTURE` — PASS, deterministic exit 64 in both builds.
- `plutil -lint apps/desktop_flutter/macos/Runner.xcodeproj/project.pbxproj` — PASS.
- `flutter analyze --no-pub --no-fatal-infos` using the isolated warm SDK/cache — PASS with 296 pre-existing infos.
- `flutter test --no-pub test/features/agents/issue_1350_mcp_app_host_policy_test.dart` — ENVIRONMENT BLOCKED before test load: binding `127.0.0.1:0` returned `EPERM`.

## Notes

- Exact missing/invalid mode parsing is `off`; the standalone host fixture additionally refuses to launch when mode is off.
- This worker cannot produce interactive packaged `Rhythm.app` WebKit evidence. The required valid/malicious Debug and packaged Release matrix is specified in the accompanying manual evidence contract.
- No backend, MCP execution, persistence schema, or arbitrary network surface was added.
