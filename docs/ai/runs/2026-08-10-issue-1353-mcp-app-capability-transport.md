---
date: 2026-08-10
repo: Rhythm
branch: mega-ws/mcp-apps
pr: null
issues: [1353]
status: partial
tags: [run, Rhythm]
---

# Issue #1353 — MCP App capability broker and Flutter transport

## Files

- Added a process-local opaque API capability broker and authoritative persisted-call binding derivation.
- Added owned session capability issue/request routes; execution stops at the #1357 authorization gate.
- Added a bounded Flutter correlation transport and wired interactive mode through the trusted shell.
- Added focused unit/contract and env-gated live tests.

## Checks

- `cd apps/api_server && ./node_modules/.bin/tsc --noEmit` — PASS.
- `cd apps/api_server && ./node_modules/.bin/vitest run src/__tests__/issue_1353_mcp_app_capability_broker.test.ts src/__tests__/issue_1353_mcp_app_capability_live.test.ts` — PASS: 2 tests; live test skipped without `RHYTHM_LIVE_E2E=1`.
- `cd apps/desktop_flutter && /private/tmp/rhythm-mcp-apps-flutter-sdk/bin/cache/dart-sdk/bin/dart --packages=.dart_tool/package_config.json tool/contracts/issue_1353_transport.dart` — PASS.
- `cd apps/desktop_flutter && PUB_CACHE=/private/tmp/rhythm-mcp-apps-pub-cache FLUTTER_SUPPRESS_ANALYTICS=true /private/tmp/rhythm-mcp-apps-flutter-sdk/bin/flutter analyze --no-pub --no-fatal-infos` — PASS with 296 pre-existing infos and no errors.
- Live sandbox — NOT RUN: this worker cannot bind sockets; the env-gated test is ready for the orchestrator.

## Notes

- Every non-canonical mode fails closed; capability issuance requires exact `interactive`.
- The iframe receives no bearer token, localhost API address, server/resource binding, or raw MCP transport.
- A valid request is consumed once and deliberately returns 403 at the next authorization gate; #1357 owns execution.
