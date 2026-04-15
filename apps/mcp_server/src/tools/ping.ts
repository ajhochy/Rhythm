import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { apiGet, toolResult, toolError } from '../api_client.js';

interface HealthResponse {
  status: string;
  service: string;
  authenticatedAs?: string;
}

export function registerPingTool(server: McpServer, apiUrl: string, apiToken: string) {
  server.tool(
    'rhythm_ping',
    'Check connectivity to the Rhythm API and confirm the session token is valid. Returns server status and the email address the token authenticates as.',
    {},
    async () => {
      try {
        const health = await apiGet<HealthResponse>(apiUrl, apiToken, '/health');
        const lines: string[] = [`Rhythm API status: ${health.status}`];
        if (health.authenticatedAs) {
          lines.push(`Authenticated as: ${health.authenticatedAs}`);
        } else {
          lines.push('Warning: token not recognized — check RHYTHM_API_TOKEN');
        }
        return toolResult(lines.join('\n'));
      } catch (err) {
        return toolError(err);
      }
    },
  );
}
