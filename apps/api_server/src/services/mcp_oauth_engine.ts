/**
 * MCP remote-OAuth workaround — process-wide service singleton.
 *
 * Spec: docs/superpowers/specs/2026-06-17-mcp-remote-oauth-workaround.md
 *
 * Wires the {@link McpOAuthService} to the live opencode engine: the reconnect
 * callback dispatches to the RAW `client.mcp.connect` ({@link
 * OpencodeClientService.reconnectMcp}), NOT the auth.start-first `connectMcp`,
 * so once we have written tokens into mcp-auth.json the engine simply re-reads
 * them. The shared loopback callback server is owned by the service and bound
 * lazily on the first `start()`.
 */

import { McpOAuthService } from './mcp_oauth_service';
import { opencodeClient } from './opencode_engine';

/** Singleton MCP OAuth service — shared across the server. */
export const mcpOAuthService = new McpOAuthService({
  reconnect: (name: string) => opencodeClient.reconnectMcp(name),
});
