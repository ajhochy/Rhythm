---
date: 2026-08-10
repo: Rhythm
branch: mega-ws/mcp-apps
pr: null
issues: [1343]
status: no-go
tags: [run, Rhythm]
---

# Issue #1343 MCP App isolation feasibility run

## Files

- `McpAppIsolationProbePolicy.swift`: disposable fail-closed WebKit policy.
- `McpAppIsolationProbeLauncher.swift`: standalone DEBUG/env-gated native UI.
- `McpAppIsolationProbeContractDriver.swift` and Node wrapper: five executable
  policy cases.
- Manual evidence contract and dated NO-GO ADR.

## Checks

- RED: `node --test apps/desktop_flutter/macos/RunnerTests/issue_1343_mcp_app_isolation_probe_contract.test.mjs`
  failed all five cases because the policy file did not exist.
- GREEN: the same command with writable compiler cache variables passed 5/5.
- Native compile: `CLANG_MODULE_CACHE_PATH=/private/tmp/rhythm-mcp-apps-clang-cache SWIFT_MODULECACHE_PATH=/private/tmp/rhythm-mcp-apps-swift-cache xcrun swiftc -D DEBUG -framework Cocoa -framework WebKit macos/Runner/McpAppIsolationProbePolicy.swift macos/RunnerTests/McpAppIsolationProbeLauncher.swift -o /private/tmp/rhythm-mcp-app-isolation-probe-final`
  passed.
- Rollback/guard check: invoking the probe without
  `RHYTHM_MCP_APPS_ISOLATION_PROBE=1` exited 64 and printed the expected refusal.
- `git diff --check` passed.
- `flutter build macos --debug --no-pub` was ENVIRONMENT BLOCKED: Xcode could
  not access its simulator/cache services and reported the workspace as
  unavailable inside the managed sandbox.

## Notes

Host matrix available to the worker: macOS 26.5.2 arm64, Xcode 26.5, Swift
6.3.2. The UI was not launched and a packaged Release probe was not created.
The official AppBridge was unavailable offline, so no dependency or version was
added. M1–M6 remain pending in both interactive DEBUG and packaged Release;
the ADR therefore records NO-GO.
