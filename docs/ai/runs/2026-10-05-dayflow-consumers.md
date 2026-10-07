---
date: 2026-10-05
repo: rhythm
branch: unavailable
pr: null
issues: []
status: unverified
tags: [run, rhythm, dayflow]
---

# Dayflow desktop companion and managed MCP consumers

## Files

- Added narrow Electron Dayflow host/IPC controller and deterministic unit tests.
- Added local renderer bridge, native-settings panel, standalone tool hook, and
  isolated Vite/Playwright fixture.
- Added two scoped MCP reader registrations and unit coverage.
- Added builder-only integration instructions; builder-owned files were not edited.

## Checks

- `apps/electron: node --test test/dayflow-desktop.test.mjs` — pass (4 tests).
- `apps/mcp_server: npm exec -- vitest run src/tools/__tests__/dayflow.test.ts` — pass (3 tests).
- `apps/mcp_server: npm run typecheck` — pass.
- `apps/mcp_server: npm exec -- vitest run src/__tests__/mcp_capabilities_and_tool_registration.test.ts src/security/__tests__/external_content_role_graph.test.ts src/tools/__tests__/dayflow.test.ts` — pass (3 files, 12 tests). The registration inventory now pins 26 registrars / 107 names, and the role graph classifies both Dayflow tools as backend-managed external activity evidence reads.
- `apps/web: npx tsc -p tsconfig.app.json --noEmit` — pass after keeping the bridge declaration local.
- `apps/web: npm run build` — pass.
- `apps/web: npm run test:dist-smoke` — pass outside the filesystem sandbox;
  the first in-sandbox attempt was blocked by loopback-bind `EPERM`.
- Headless local Chrome captured `/private/tmp/dayflow-desktop-settings.png` and
  `/private/tmp/dayflow-tool.png`; both show native-window-only language and no
  fabricated activity screen.
- The isolated Playwright command is blocked in this environment: Chrome aborts
  before test execution when launched through Playwright's remote-debugging pipe.
  Direct headless Chrome rendering succeeds. The test remains present unchanged.

## Notes

- No Dayflow app was opened, no activity data was read, and no capture/provider,
  privacy, consent, profile, security, or endpoint configuration was changed.
- MCP response validation is fail-closed. The server-side managed-evidence port
  is still coordinator-owned and absent, so no live MCP readiness is claimed.
- The Dayflow MCP consumer follows the accepted contract: only `{ trustedCall }`
  is posted (the signed args contain query/limit); backend-managed scan, taint,
  and fencing are not duplicated by the consumer. External-read plus protected-
  write roles continue to require the existing approval tool.
