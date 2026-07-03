---
tags: [decision, rhythm]
---

# Pin/bundle the rhythm MCP server version (#814)

## Context

`ensureRhythmMcp()` in `apps/api_server/src/services/opencode_client_service.ts`
launched the rhythm MCP server with a bare, unversioned npx spec:
`['npx', '-y', '@ajhochy/rhythm-mcp-server']`. A bare spec lets a stale
GLOBAL install of the package shadow the published version — observed in the
wild (a stale global 0.6.0 shadowed a published 0.6.1). Runtime `npx` fetch is
also offline-fragile.

## Decision

Implemented the bundle-with-pinned-fallback approach recommended by the issue,
in `resolveRhythmMcpCommand()` (new export, `opencode_client_service.ts`):

1. **Dev override** — `RHYTHM_MCP_SERVER_BIN` (absolute path to a built
   `dist/index.js`), mirroring `RHYTHM_OPENCODE_BIN` for the fork engine.
   Highest priority so a developer can point at a locally-built payload.
2. **Bundled payload** — probes `Contents/Resources/mcp_server/dist/index.js`
   (sibling of the already-bundled `api_server` and `opencode_bin`), launched
   via `['node', <absolutePath>]`. No npx, no global, no network.
3. **Pinned fallback** — when neither of the above is present (dev, or an
   older release predating the bundling step), builds
   `@ajhochy/rhythm-mcp-server@<version>`, where `<version>` is read once by
   `readRhythmMcpServerVersion()` from `apps/mcp_server/package.json` (single
   source of truth — bump that file's version and the pin tracks it).
4. Only if the version cannot be resolved at all (should not happen in a
   checked-out monorepo) does it fall back to the historical bare spec, with a
   WARN log.

`ensureRhythmMcp()` now calls `resolveRhythmMcpCommand()` instead of hardcoding
the argv array. This is the single place the command is defined; the
curated-MCP path (`curated_mcp_servers.ts` / `ensureCuratedMcps()`) does not
define rhythm at all — rhythm has always been ensured separately via
`ensureRhythmMcp`, so there was no second definition to reconcile.

Added `.github/workflows/desktop_release.yml` steps ("Build rhythm MCP
server" / "Bundle rhythm MCP server into app (#814)" / "Verify bundled rhythm
MCP server payload") that build `apps/mcp_server` and copy
`dist/ + package.json + package-lock.json + node_modules` (prod deps only)
into `Contents/Resources/mcp_server`, mirroring the existing `api_server`
bundling step exactly.

## Alternatives considered

- **Pin-only (no bundling)**: simpler, but still requires network at every
  engine (re)start and doesn't fully close the "stale global" risk if a
  developer's global cache/registry mirror serves a stale tarball for the
  pinned version tag. Bundling is strictly more robust and was already the
  established pattern (opencode fork, api_server itself).
- **Vendor mcp_server into opencode_fork's build**: rejected — `opencode_fork`
  is an upstream vendored subtree (AGENTS.md) and must not gain new build-
  pipeline dependents.

## Consequences

- A full real-binary smoke (spawn the resolved command, assert `tools/list`
  includes `rhythm_remember_memory` / `rhythm_list_sessions`) was NOT run in
  this environment — documented as a manual smoke step in
  `opc_rhythm_mcp_command.test.ts`'s trailing comment block, backed by a
  grep-confirmed source check that both tools exist in
  `apps/mcp_server/src/tools/{agentMemory,agentSessions}.ts`.
- **Follow-up (out of scope here, filed for tracking):** the new
  `desktop_release.yml` bundling steps are untested by an actual CI run in
  this session (no CI trigger was fired). The next real desktop release run
  should be watched for the new "Verify bundled rhythm MCP server payload"
  step passing, in case `npm install --omit=dev` under `apps/mcp_server`
  surfaces a platform-specific issue analogous to the `better-sqlite3` ABI
  gotcha already known for `api_server`. `@modelcontextprotocol/sdk` and
  `zod` are both pure-JS (no native bindings), so this risk is low but
  unverified end-to-end.
