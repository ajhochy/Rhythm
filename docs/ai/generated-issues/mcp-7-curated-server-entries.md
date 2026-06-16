# MCP-7: Per-server curated config entries (remaining 6)

## Summary

Add the remaining 6 entries to `CURATED_MCP_SERVERS` with exact package/URL, type, and requiredEnv metadata: PCO, Google Workspace, Canva, Stripe, Mailchimp, and Notion. Record all exact choices in `decisions.md` for future reference and PR review.

## Goal

- Add 6 new entries to `CURATED_MCP_SERVERS` (PCO, Google Workspace, Canva, Stripe, Mailchimp, Notion)
- Specify exact npm package names, remote URLs, and server types
- Include `requiredEnv: string[]` metadata for each
- Ensure all 7 entries (including PDF Tools from MCP-2) are present and correct
- Idempotent on second run with all 7 entries

## Likely Files

- `apps/api_server/src/config/curated_mcp_servers.ts`
- `docs/ai/decisions.md`

## Test Files

- `apps/api_server/src/routes/__tests__/opc_curated_mcp_ensure.test.ts` (extend existing)

## Dependencies

- **MCP-2** (ensure function)
- **MCP-3** (secrets UI)
- **MCP-5** (autoinstall wiring)
- **MCP-6** (token bridge)

---

## Acceptance Criteria

### c1: Seven entries in registry
- `CURATED_MCP_SERVERS` contains exactly 7 entries with these IDs:
  - `pdf-tools`
  - `pco` (Planning Center)
  - `google-workspace`
  - `canva`
  - `stripe`
  - `mailchimp`
  - `notion`

### c2: Remote server types
- Canva and Notion entries are `type:'remote'` with:
  - Non-empty `url` field pointing to the official remote server
  - No `command` field
  - Empty `requiredEnv: []` (OAuth handled by opencode)

### c3: Local server types
- Stripe, Mailchimp, PCO, Google Workspace, and PDF Tools entries are `type:'local'` with:
  - Non-empty `command` argv (npm package name or full command)
  - No `url` field
  - `requiredEnv: string[]` listing expected environment variable keys (e.g., `['STRIPE_API_KEY']`)

### c4: RequiredEnv metadata
- Each entry carries `requiredEnv: string[]` metadata:
  - PDF Tools: `[]` (zero-auth)
  - Remote servers (Canva, Notion): `[]` (OAuth-on-first-use)
  - Key-based servers (Stripe, Mailchimp): keys they expect (e.g., `['API_KEY']`)
  - Token-bridged servers (PCO, Google): keys for token injection (to be confirmed with MCP-6)

### c5: Idempotent registry
- Ensure the full 7-server set on an empty config:
  - All 7 entries are written (minus any cleanly-skipped uncredentialed servers per MCP-6 c3)
  - Second run is byte-identical no-op (`changed:false`)
  - Each entry preserves its exact config across runs

### c6: Decisions recorded
- `docs/ai/decisions.md` is updated to record:
  - Exact npm package names / remote URLs for each server
  - Rationale for package choice (e.g., "official Stripe server", "maintained community fork")
  - Any fallback paths (e.g., PCO PAT vs. token-bridge)
  - Credential approach for each server
