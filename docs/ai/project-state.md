# Project State

## Current focus

PR #812 is merged into `main`. Current work isolates machine-local MCP server
extensions from the separate local Ollama integration.

## Active branch / PR

- `main` includes PR #812 at merge commit `368002168`.
- MCP sidecar branch: `codex/local-mcp-sidecar`; draft PR #835.
- Ollama work is preserved locally on `codex/local-ollama-wip-2026-07-01`.

## In progress

- Add a gitignored `curated_mcp_servers.local.json` sidecar.
- Validate local server definitions and fail soft on missing, malformed, or
  structurally invalid files.
- Support `RHYTHM_LOCAL_MCP_SERVERS_PATH` for explicit runtime placement.

## Risks / known issues

- The local sidecar may contain personal API keys and must never be committed.
- Invalid sidecars are ignored with a warning so API startup remains available.
- The bundled-fork event-stream regression remains tracked separately by #759.

## Test status

- PR #812 Desktop, Server, and MCP GitHub CI: pass.
- `ai-workflow checks --level pr`: pass.
- API tests: 178 files / 1,526 tests passed.
- API production TypeScript build: pass.
- Compiled-loader smoke with an explicit sidecar path: pass.
- GitNexus pre-edit impact: LOW risk, no affected execution flows.

## Next step

Confirm Desktop, Server, and MCP CI on draft PR #835, then review the local
sidecar contract before marking it ready.
