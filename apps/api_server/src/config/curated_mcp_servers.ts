/**
 * MCP-2 — Curated MCP server registry.
 *
 * `CURATED_MCP_SERVERS` is the source-of-truth list of MCP servers Rhythm
 * offers to auto-install into the user's opencode.json. `ensureCuratedMcps()`
 * in opencode_client_service.ts idempotently merges this list into the
 * `mcp` block (add missing, refresh changed, no-op identical).
 *
 * Verified catalog (2026-06-17) — pinned to packages whose existence + env
 * requirements were confirmed via npm + official docs:
 *   - pdf-tools  (local, zero-auth)  @modelcontextprotocol/server-pdf@1.7.4
 *   - canva      (remote, OAuth/DCR) https://mcp.canva.com/mcp        (official)
 *   - notion     (remote, OAuth/DCR) https://mcp.notion.com/mcp       (official)
 *   - stripe     (local, API key)    @stripe/mcp@0.3.3
 *   - mailchimp  (local, API key)    @agentx-ai/mailchimp-mcp-server@1.1.1
 *
 * DROPPED (no installable npm package; already brokered by the rhythm MCP):
 *   - google-workspace — @modelcontextprotocol/server-google-workspace does
 *     not exist on npm; the rhythm MCP brokers Gmail + Calendar (F3).
 *   - planning-center  — no installable PCO MCP package exists; the rhythm MCP
 *     brokers PCO (F4).
 *
 * NOTE: with google/pco dropped, NO curated entry sets `tokenProvider`, so the
 * OAuth token-bridge in `ensureCuratedMcps()` currently has no curated
 * consumer. The bridge mechanism + its types are intentionally left in place
 * (covered by a synthetic fixture in opc_curated_mcp_token_bridge.test.ts) for
 * future bridged servers.
 *
 * See docs/ai/decisions.md for per-server rationale, pins, and credential
 * approach.
 */

/**
 * MCP-6 — the Rhythm integration provider whose fresh OAuth access token is
 * injected into a curated server's `environment` at ensure time. This is the
 * key the token bridge in `ensureCuratedMcps()` keys off of; it is NOT
 * persisted into opencode.json (only `id/name/type/command|url/environment`
 * are). See `CuratedMcpServer.tokenProvider` / `.tokenEnvKey`.
 */
export type CuratedTokenProvider = 'google' | 'pco';

/**
 * A curated MCP server definition.
 *
 * - `type: 'local'`  → stdio server launched via `command` (argv array).
 * - `type: 'remote'` → HTTP server reachable at `url`.
 *
 * `requiredEnv` lists the environment variable names the server needs to
 * function. For zero-auth servers this is `[]`. The MCP-7 work uses it to
 * drive the "needs credentials" UI; MCP-2 only needs the empty case.
 */
export interface CuratedMcpServer {
  /** Stable identifier used as the key in opencode.json's `mcp` block. */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** Transport kind. */
  type: 'local' | 'remote';
  /** argv for local stdio servers (required when type === 'local'). */
  command?: string[];
  /** endpoint for remote servers (required when type === 'remote'). */
  url?: string;
  /** Environment variables persisted into the opencode.json entry. */
  environment?: Record<string, string>;
  /** Names of env vars the server requires; `[]` for zero-auth servers. */
  requiredEnv: string[];
  /**
   * MCP-6 — when set, this server's credential is bridged from Rhythm's stored
   * OAuth tokens. At ensure time `ensureCuratedMcps()` reads a FRESH access
   * token for this provider (via the existing `ensureFresh*Account` refresh
   * path) and injects it into `environment[tokenEnvKey]`. When no account is
   * connected (no row / no token), the server is SKIPPED entirely — it is never
   * written with an empty placeholder token. Omit for zero-auth servers.
   */
  tokenProvider?: CuratedTokenProvider;
  /**
   * MCP-6 — the `environment` key the bridged fresh access token is injected
   * into. Required when `tokenProvider` is set; ignored otherwise. This key is
   * also listed in `requiredEnv`.
   */
  tokenEnvKey?: string;
}

export const CURATED_MCP_SERVERS: CuratedMcpServer[] = [
  {
    id: 'pdf-tools',
    name: 'PDF Tools',
    type: 'local',
    // Verified: @modelcontextprotocol/server-pdf@1.7.4. The package DEFAULTS to
    // an HTTP transport, so the MCP stdio handshake requires `--stdio` (its
    // absence was the prior "Connection closed"). `--silent` keeps npx noise off
    // the stdio channel. Zero-auth → requiredEnv: [] (never gated by the
    // needs-credentials UI).
    command: [
      'npx',
      '-y',
      '--silent',
      '@modelcontextprotocol/server-pdf',
      '--stdio',
    ],
    requiredEnv: [],
  },
  {
    id: 'canva',
    name: 'Canva',
    type: 'remote',
    // Verified official Canva hosted MCP (OAuth/DCR on first use by opencode —
    // no API key, hence requiredEnv: []).
    url: 'https://mcp.canva.com/mcp',
    requiredEnv: [],
  },
  {
    id: 'notion',
    name: 'Notion',
    type: 'remote',
    // Verified official Notion hosted MCP (OAuth/DCR on first use by opencode).
    url: 'https://mcp.notion.com/mcp',
    requiredEnv: [],
  },
  {
    id: 'stripe',
    name: 'Stripe',
    type: 'local',
    // Verified: @stripe/mcp@0.3.3. Reads its restricted secret key from
    // STRIPE_SECRET_KEY in the environment (alternatively `--api-key=`);
    // supplied via the needs-credentials secrets UI.
    command: ['npx', '-y', '@stripe/mcp', '--tools=all'],
    requiredEnv: ['STRIPE_SECRET_KEY'],
  },
  {
    id: 'mailchimp',
    name: 'Mailchimp',
    type: 'local',
    // Verified: @agentx-ai/mailchimp-mcp-server@1.1.1. Reads MAILCHIMP_API_KEY
    // from the environment; the key MUST include its data-center suffix
    // (e.g. `<key>-us21`), so no separate server-prefix env var is needed.
    // Supplied via the needs-credentials secrets UI.
    command: ['npx', '-y', '@agentx-ai/mailchimp-mcp-server'],
    requiredEnv: ['MAILCHIMP_API_KEY'],
  },
];
