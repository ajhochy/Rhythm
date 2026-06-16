/**
 * MCP-2 — Curated MCP server registry.
 *
 * `CURATED_MCP_SERVERS` is the source-of-truth list of MCP servers Rhythm
 * offers to auto-install into the user's opencode.json. `ensureCuratedMcps()`
 * in opencode_client_service.ts idempotently merges this list into the
 * `mcp` block (add missing, refresh changed, no-op identical).
 *
 * MCP-2 ships ONLY the zero-auth PDF Tools entry as a first end-to-end proof.
 * The remaining six curated servers (which carry `requiredEnv` credentials)
 * land in MCP-7 — do NOT add them here.
 */

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
];
