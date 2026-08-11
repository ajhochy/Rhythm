---
date: 2026-08-10
repo: Rhythm
branch: mega-ws/mcp-apps
pr: null
issues: [1356]
status: environment-blocked
tags: [run, Rhythm, mcp-apps, security]
---

# MCP Apps GA hardening

## Files

- Added a checked-in malicious fixture matrix and native/Dart/fork proof abuse tests.
- Added per-view rate/teardown, device-permission, and external-link denials.
- Added an intentionally unwired context-update policy requiring interactive mode, human confirmation, 16 KiB bounds, injection scanning, external-untrusted taint, and fencing.
- Added architecture/operations/troubleshooting documentation and the packaged all-mode/two-pilot manual matrix.
- Added an env-gated real API mode/resource test. No SQL, MCP tool registration, or index file changed.

## Checks

- `node --test apps/desktop_flutter/macos/RunnerTests/issue_1350_mcp_app_host_contract.test.mjs apps/desktop_flutter/macos/RunnerTests/issue_1356_mcp_apps_ga_contract.test.mjs apps/desktop_flutter/macos/RunnerTests/issue_1356_mcp_apps_ga_live.test.mjs` — PASS: 11 passed, 2 live tests skipped; native Swift policy compiled for all five cases.
- `cd apps/opencode_fork/packages/opencode && bun test test/session/issue_1356_mcp_apps_ga_security.test.ts test/session/issue_1357_mcp_app_execution_gate.test.ts` — PASS: 3 tests, 33 expectations.
- Targeted Dart formatter with `--set-exit-if-changed` — PASS: 3 files, 0 changed after formatting.
- `flutter analyze --no-pub --no-fatal-infos` using the isolated SDK/cache — PASS after the final fix: 296 pre-existing infos, zero errors.
- `flutter test --no-pub test/features/agents/issue_1356_mcp_app_ga_security_test.dart` — ENVIRONMENT BLOCKED before assertions: binding `127.0.0.1:0` returned EPERM.
- Env-gated live tests — SKIPPED by design because this worker cannot bind sockets.
- Packaged macOS two-pilot/all-mode smoke — NOT RUN: no packaged UI capability in this worker.

## Notes

`interactive` remains disabled pending named human approval of the complete
packaged matrix. Any fail-open result blocks GA; `off` remains the default and
immediate rollback. The checked-in context policy is not connected to a UI or
agent context sink, because no safe confirmation + durable taint path exists.
