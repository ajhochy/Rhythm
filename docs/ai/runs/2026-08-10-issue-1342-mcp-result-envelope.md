---
date: 2026-08-10
repo: Rhythm
branch: mega-ws/mcp-apps
pr: null
issues: [1342]
status: implemented-environment-limited
tags: [run, Rhythm]
---

# Issue #1342 — MCP result envelope

## Files

- Added a bounded, JSON-safe MCP result envelope to the vendored engine's completed tool state.
- Preserved the existing text output through engine and API persistence.
- Added Flutter parsing and an inert, collapsed JSON fallback renderer.
- Added fork, API, Flutter, and environment-gated live contract coverage.

## Checks

- `bun test test/session/issue_1342_mcp_result_envelope.test.ts` — PASS (1 test).
- `bun run typecheck` in the fork package — PASS.
- `vitest run src/__tests__/issue_1342_mcp_result_envelope.test.ts src/__tests__/issue_1342_mcp_result_envelope_live.test.ts` — PASS (2 tests; live test skipped without its env flag).
- `tsc --noEmit` in `apps/api_server` — PASS.
- `flutter analyze --no-pub --no-fatal-infos` — PASS with 296 pre-existing infos.
- Dart format check on the three issue files — PASS (0 changed).
- `flutter test --no-pub test/features/agents/issue_1342_mcp_result_envelope_test.dart` — ENVIRONMENT BLOCKED before assertions: binding `127.0.0.1:0` returned EPERM.
- GitNexus `detect-changes --scope all` — MEDIUM; expected `Build → ChatPart` and `Main → ChatPart` flows.

## Notes

- The live fork/API/Flutter behavioral test remains gated for the outer orchestrator because this managed sandbox cannot bind loopback sockets.
- No database migration is required; the additive envelope persists in the existing `parts_json` column.
