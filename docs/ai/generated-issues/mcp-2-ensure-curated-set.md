# MCP-2: Idempotent ensureCuratedMcps() + curated registry scaffold + route

## Summary

Implement a new `ensureCuratedMcps(opts)` function that idempotently merges a `CURATED_MCP_SERVERS` array into the `opencode.json` `mcp` block: adds missing entries, refreshes changed ones, and no-ops identical entries (via JSON-compare). Persist the environment, best-effort live-register with the SDK (non-fatal on failure), and expose the function via `POST /opencode/mcp/curated/ensure` returning `{changed, registered, servers}`. Prove end-to-end with PDF Tools (zero-auth local stdio) as the first registry entry.

## Goal

- New `ensureCuratedMcps(opts)` function merges `CURATED_MCP_SERVERS` into `opencode.json` `mcp` block
  - Adds missing entries
  - Refreshes changed entries
  - No-ops identical entries via JSON-compare
- Persists `environment` to disk
- Best-effort live-register with SDK (non-fatal on failure)
- Exposed via `POST /opencode/mcp/curated/ensure` returning `{changed, registered, servers:[...]}`
- Proven end-to-end with PDF Tools (zero-auth local stdio) as first registry entry

## Likely Files

- `apps/api_server/src/services/opencode_client_service.ts` (or new `services/curated_mcp.ts`)
- New `apps/api_server/src/config/curated_mcp_servers.ts`
- `apps/api_server/src/routes/opencode_mcp_routes.ts`

## Test Files

- `apps/api_server/src/routes/__tests__/opc_curated_mcp_ensure.test.ts` (new)

## Dependencies

- **MCP-1** (environment map plumbing must exist first)

---

## Acceptance Criteria

### c1: Ensure adds missing entries
- When `ensureCuratedMcps()` is called on an `opencode.json` lacking PDF Tools:
  - Entry is added (`changed:true` in response)
  - File contains the PDF Tools `{type:'local',command:[...]}` entry with correct shape

### c2: Idempotent no-op on identical config
- When `ensureCuratedMcps()` is called again with identical config:
  - Returns `changed:false`
  - File is byte-identical to previous run (no spurious rewrites)

### c3: Refresh on changed entry
- When an entry's desired config differs (e.g., env changed):
  - That entry is rewritten in the file
  - Unrelated `mcp` entries (including `rhythm`) are preserved exactly
  - File diff shows only the intended change

### c4: Non-fatal live-register failure
- When SDK live-register throws (e.g., SDK error):
  - Function returns `{changed:true, registered:false, servers:[...]}`
  - Function does not throw; returns gracefully
  - File write succeeded before the SDK failure

### c5: Route response shape
- `POST /opencode/mcp/curated/ensure` returns HTTP 200 with JSON body:
  - `{changed: boolean, registered: boolean, servers: [...]}`
  - `servers` array contains at least the PDF Tools entry with correct shape
  - Response values (if any) are not secret-containing (no exposed API keys)
