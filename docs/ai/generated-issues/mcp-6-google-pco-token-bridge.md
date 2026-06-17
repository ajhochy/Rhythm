# MCP-6: Google + PCO token bridge (reuse stored OAuth)

## Summary

Implement the smallest mechanism to make Rhythm's persisted per-user Google/PCO tokens usable by their MCP servers. Read fresh tokens from `integration_accounts` (reusing `ensureFresh*Account` paths), inject them into the curated server's `environment` at ensure time, and cleanly skip servers when no token is connected. Never expose tokens in responses.

## Goal

- Read fresh tokens from `integration_accounts` table for Google and PCO
- Reuse existing `ensureFresh*Account` refresh logic
- Inject fresh access token into curated server's `environment` at ensure time
- Clean, non-fatal skip when no account is connected (no empty token written)
- Injected token values never returned verbatim in API responses (redacted)

## Likely Files

- `apps/api_server/src/services/curated_mcp.ts` (or `opencode_client_service.ts`)
- `apps/api_server/src/services/integrations_service.ts`
- `apps/api_server/src/repositories/integration_accounts_repository.ts`
- `apps/api_server/src/config/curated_mcp_servers.ts`

## Test Files

- `apps/api_server/src/routes/__tests__/opc_curated_mcp_token_bridge.test.ts` (new)

## Dependencies

- **MCP-2** (ensure function exists)

---

## Acceptance Criteria

### c1: Inject fresh Google/PCO tokens
- When a Google `integration_account` row with a valid token exists:
  - Ensuring the Google curated server injects the fresh access token into that server's `environment`
  - Assert the environment key the chosen server expects is populated correctly
- Same for PCO with its expected environment key

### c2: Refresh path integration
- Token bridge calls the existing `ensureFresh*Account` refresh path
- Assert refresh is invoked when `expires_at` is in the past
- Fresh token is used in the `environment`

### c3: Clean skip when no account
- When no Google/PCO account is connected:
  - The corresponding curated server is skipped (not written with an empty token)
  - `ensureCuratedMcps()` does not throw
  - Other servers continue to install normally

### c4: Token redaction in responses
- Token values are never returned verbatim in the route response
- API response `servers` array redacts token values
- Assert response contains no plaintext tokens or bearer values
