---
date: 2026-11-03
repo: Rhythm
branch: fix/mcp-ui-extension-optional-mimetypes
pr: TBD
issues: [1622]
status: verified-awaiting-deploy
tags: [run, rhythm]
index: "[[Rhythm]]"
---

## Files
- `apps/opencode_fork/packages/opencode/src/mcp/index.ts`: `AppInitializeResultSchema` now makes `mimeTypes` optional inside `extensions["io.modelcontextprotocol/ui"]`. The schema is exported for the test.
- `test/mcp/ui-extension-capability.test.ts`: schema regression test (red on base, green on fix).
- `test/mcp/ui-extension-live.test.ts`: live check gated on `RHYTHM_LIVE_MCP_CMD`. It runs the real `MCP` service against a real stdio server. Run this file alone.

## Checks
- Capability test: 2/2 on the fix. The `{}` case fails on the base.
- Live test: the fix gives `connected` for both nfl_mcp (FastMCP 3.2.4) and minutes (0.25.1). The base gives `failed` for both.
- `bun test test/mcp`: 62 pass, 1 fail. The failure is `oauth-auto-connect` "authenticate() stores a connected client…", a timeout that also fails on the unmodified base.
- `bun run typecheck`: exit 0. `bun run build --single`: smoke test passed.

## Notes
- The FFB handoff guessed that fastmcp 3.2.4 was the cause. That was wrong. Raw initialize probes show both servers advertise the UI extension as `{}`, and the Rhythm client schema (mega lineage only; not on `main`) required `mimeTypes`. Pinning fastmcp would not have fixed `minutes`.
- The live app is the eager-star candidate (`4bd758e0`, LaunchAgent `com.ajhochhalter.rhythm-web-host`). It keeps failing until its engine is rebuilt with this fix, which needs AJ's approval.
- gmail-work and gmail-personal 30s timeouts were not investigated here. They are a separate cause.
