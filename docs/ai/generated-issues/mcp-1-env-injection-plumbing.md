# MCP-1: Env-map plumbing through POST /opencode/mcp + entry surfacing

## Summary

Extend `POST /opencode/mcp` to accept and persist an optional `environment` map (and explicit `type` field). The SDK's `addMcp` already passes environment to the SDK; this issue ensures it persists to `opencode.json` and that `listMcp`/`McpServerEntry` expose environment keys and a `needsCredentials` signal so the Flutter UI can flag uncredentialed servers.

## Goal

- `POST /opencode/mcp` accepts and persists an optional `environment` map and explicit `type` field
- `addMcp` already passes environment to SDK; no SDK-level changes needed
- `listMcp` and `McpServerEntry` surface `environment` keys (values may be redacted) and a boolean `needsCredentials` field
- All new shapes match the real SDK status fixtures

## Likely Files

- `apps/api_server/src/routes/opencode_mcp_routes.ts`
- `apps/api_server/src/services/opencode_client_service.ts`
- `apps/api_server/src/@types/opencode-ai-sdk.d.ts`

## Test Files

- `apps/api_server/src/routes/opencode_mcp_routes.test.ts` (extend existing)

## Dependencies

- None (starter issue)

---

## Acceptance Criteria

### c1: Environment persistence in POST /opencode/mcp
- `POST /opencode/mcp` with body `{name, command, environment:{K:'v'}}` persists `environment` into `opencode.json` `mcp[name].environment`
- Assert written file contents contain the environment map exactly

### c2: Remote server type support
- `POST /opencode/mcp` with `{name, url, type:'remote'}` persists a `{type:'remote',url}` entry with no `command`
- Assert file contents contain the remote entry shape

### c3: Validation on missing command/url
- `POST /opencode/mcp` with neither `command` nor `url` returns 400
- Assert error response is clear and testable

### c4: Environment keys exposed in GET /opencode/mcp
- `GET /opencode/mcp` entries expose:
  - `environment` keys (values may be redacted)
  - A boolean `needsCredentials` field
- Assert shape against a real-shape SDK status fixture
- Values must NOT contain secrets in the response

### c5: Regression test
- All existing `opc_m4_3_mcp_routes.test.ts` assertions still pass
- No breaking changes to command/url-only entries
