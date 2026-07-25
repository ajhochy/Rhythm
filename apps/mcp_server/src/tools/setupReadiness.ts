import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { toolError, toolResult } from '../api_client.js';
import { registerTool } from './_tool.js';

export function registerSetupReadinessTool(server: McpServer, agentUrl: string): void {
  registerTool(server, 'rhythm_get_setup_readiness', 'Read the informational local setup readiness summary (cloud login/token, usable model, Rhythm MCP, external search, optional registry URL, Planning Center, and Gmail). This never changes configuration.', {}, async () => {
    try {
      const response = await fetch(`${agentUrl}/setup-readiness`);
      if (!response.ok) throw new Error(`Rhythm agent server returned ${response.status}: ${response.statusText}`);
      return toolResult(JSON.stringify(await response.json(), null, 2));
    } catch (err) { return toolError(err); }
  });
}
