/**
 * MCP-2 — Curated MCP server registry.
 *
 * `CURATED_MCP_SERVERS` is the source-of-truth list of MCP servers Rhythm
 * offers to auto-install into the user's opencode.json. `ensureCuratedMcps()`
 * in opencode_client_service.ts idempotently merges this list into the
 * `mcp` block (add missing, refresh changed, no-op identical).
 *
 * MCP-2 ships ONLY the zero-auth PDF Tools entry as a first end-to-end proof.
 * MCP-6 adds the Google Workspace + Planning Center entries whose credentials
 * are bridged from Rhythm's stored OAuth tokens (see `tokenProvider` below).
 * The remaining curated servers land in MCP-7 — do NOT add them here.
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
    // TODO(MCP-7): confirm exact package + pin a version.
    command: ['npx', '-y', '@modelcontextprotocol/server-pdf'],
    requiredEnv: [],
  },
  {
    id: 'google-workspace',
    name: 'Google Workspace',
    type: 'local',
    // TODO(MCP-7): confirm exact package + pin a version, and confirm the real
    // server reads its bearer from GOOGLE_OAUTH_ACCESS_TOKEN (rename if not).
    command: ['npx', '-y', '@modelcontextprotocol/server-google-workspace'],
    // MCP-6 — credential bridged from Rhythm's stored Google OAuth tokens.
    tokenProvider: 'google',
    // TODO(MCP-7): confirm the env key the real server expects for the token.
    tokenEnvKey: 'GOOGLE_OAUTH_ACCESS_TOKEN',
    requiredEnv: ['GOOGLE_OAUTH_ACCESS_TOKEN'],
  },
  {
    id: 'planning-center',
    name: 'Planning Center',
    type: 'local',
    // TODO(MCP-7): confirm exact package + pin a version, and confirm the real
    // server reads its bearer from PCO_ACCESS_TOKEN (rename if not).
    command: ['npx', '-y', '@ajhochy/pco-mcp-server'],
    // MCP-6 — credential bridged from Rhythm's stored Planning Center OAuth tokens.
    tokenProvider: 'pco',
    // TODO(MCP-7): confirm the env key the real server expects for the token.
    tokenEnvKey: 'PCO_ACCESS_TOKEN',
    requiredEnv: ['PCO_ACCESS_TOKEN'],
  },
];
