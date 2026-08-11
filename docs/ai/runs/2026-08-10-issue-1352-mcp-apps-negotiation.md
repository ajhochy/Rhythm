---
date: 2026-08-10
repo: Rhythm
branch: mega-ws/mcp-apps
pr: null
issues: [1352]
status: implemented-environment-limited
tags: [run, Rhythm]
---

# Issue #1352 — MCP Apps negotiation and UI descriptors

## Files

- Added strict MCP Apps mode parsing and stable extension advertisement to the fork MCP client.
- Preserved and validated nested `_meta.ui` descriptors in normal and tolerant tool discovery.
- Added an app-visible registry and excluded app-only or ambiguous tools from model schemas and model key maps.
- Updated MCP client test doubles for the SDK server-capability contract.
- Added focused and environment-gated live contracts.

## Checks

- `bun test test/mcp/issue_1352_mcp_apps_contract.test.ts test/mcp/lifecycle.test.ts` — PASS (26 tests, 75 assertions).
- `bun test test/session/issue_1352_mcp_apps_live.test.ts` — PASS as gated (1 skipped without `RHYTHM_LIVE_E2E=1`).
- `bun run typecheck` — PASS.
- `git diff --check` — PASS.
- OAuth callback/browser suites — ENVIRONMENT BLOCKED because the managed sandbox cannot bind callback server ports; assertions do not complete reliably.

## Notes

- Missing or invalid `RHYTHM_MCP_APPS_MODE` values fail closed to `off`.
- Unsupported peers retain legacy model-tool behavior and never populate the app registry.
- The socket-capable outer orchestrator must run the live negotiation/filtering fixture.
