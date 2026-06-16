/**
 * MCP-2 — Curated MCP server registry.
 *
 * `CURATED_MCP_SERVERS` is the source-of-truth list of MCP servers Rhythm
 * offers to auto-install into the user's opencode.json. `ensureCuratedMcps()`
 * in opencode_client_service.ts idempotently merges this list into the
 * `mcp` block (add missing, refresh changed, no-op identical).
 *
 * MCP-2 ships the zero-auth PDF Tools entry as a first end-to-end proof.
 * MCP-6 adds the Google Workspace + Planning Center entries whose credentials
 * are bridged from Rhythm's stored OAuth tokens (see `tokenProvider` below).
 * MCP-7 completes the set to 7: adds Canva + Notion (remote, OAuth-on-first-use
 * via opencode), Stripe + Mailchimp (local, API key supplied via the secrets
 * UI). See docs/ai/decisions.md (2026-06-16) for per-server rationale, pins,
 * and credential approach. Pins marked TODO(verify-pin) must be confirmed at PR.
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
    // TODO(verify-pin): confirm package/url + env keys before release —
    // the published PDF Tools package name + a pinned version are unconfirmed.
    command: ['npx', '-y', '@modelcontextprotocol/server-pdf'],
    requiredEnv: [],
  },
  {
    id: 'google-workspace',
    name: 'Google Workspace',
    type: 'local',
    // TODO(verify-pin): confirm package/url + env keys before release —
    // confirm the published package name + pin, and that the server reads its
    // bearer from GOOGLE_OAUTH_ACCESS_TOKEN (rename tokenEnvKey/requiredEnv if not).
    command: ['npx', '-y', '@modelcontextprotocol/server-google-workspace'],
    // MCP-6 — credential bridged from Rhythm's stored Google OAuth tokens.
    tokenProvider: 'google',
    tokenEnvKey: 'GOOGLE_OAUTH_ACCESS_TOKEN',
    requiredEnv: ['GOOGLE_OAUTH_ACCESS_TOKEN'],
  },
  {
    id: 'planning-center',
    name: 'Planning Center',
    type: 'local',
    // TODO(verify-pin): confirm package/url + env keys before release —
    // @ajhochy/pco-mcp-server is the in-house server; pin a version, and confirm
    // it reads its bearer from PCO_ACCESS_TOKEN (rename if not). Fallback to a
    // PCO Personal Access Token via the secrets UI if the token bridge is
    // unavailable (no connected PCO OAuth account).
    command: ['npx', '-y', '@ajhochy/pco-mcp-server'],
    // MCP-6 — credential bridged from Rhythm's stored Planning Center OAuth tokens.
    tokenProvider: 'pco',
    tokenEnvKey: 'PCO_ACCESS_TOKEN',
    requiredEnv: ['PCO_ACCESS_TOKEN'],
  },
  {
    id: 'canva',
    name: 'Canva',
    type: 'remote',
    // Official Canva hosted MCP. OAuth is initiated on first use by opencode —
    // no API key required, hence requiredEnv: [].
    // TODO(verify-pin): confirm package/url + env keys before release — confirm
    // https://mcp.canva.com/mcp is the current official remote endpoint.
    url: 'https://mcp.canva.com/mcp',
    requiredEnv: [],
  },
  {
    id: 'notion',
    name: 'Notion',
    type: 'remote',
    // Official makenotion hosted MCP. OAuth on first use by opencode.
    // TODO(verify-pin): confirm package/url + env keys before release — confirm
    // https://mcp.notion.com/mcp is the current official remote endpoint.
    url: 'https://mcp.notion.com/mcp',
    requiredEnv: [],
  },
  {
    id: 'stripe',
    name: 'Stripe',
    type: 'local',
    // Official Stripe MCP. Reads its restricted secret key from STRIPE_SECRET_KEY
    // in the environment (alternatively `--api-key=`); supplied via the secrets UI.
    // TODO(verify-pin): confirm package/url + env keys before release — pin a
    // version of @stripe/mcp.
    command: ['npx', '-y', '@stripe/mcp', '--tools=all'],
    requiredEnv: ['STRIPE_SECRET_KEY'],
  },
  {
    id: 'mailchimp',
    name: 'Mailchimp',
    type: 'local',
    // Maintained community Mailchimp Marketing MCP. Reads MAILCHIMP_API_KEY from
    // the environment; the key embeds the data-center suffix (e.g. `...-us21`),
    // so no separate server-prefix env var is required. Supplied via the secrets UI.
    // TODO(verify-pin): confirm package/url + env keys before release — community
    // (not official) package; pin a version of @agentx-ai/mailchimp-mcp-server.
    command: ['npx', '-y', '@agentx-ai/mailchimp-mcp-server'],
    requiredEnv: ['MAILCHIMP_API_KEY'],
  },
];
