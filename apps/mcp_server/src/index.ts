#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { registerPingTool } from './tools/ping.js';

const RHYTHM_API_URL = process.env.RHYTHM_API_URL ?? 'https://api.vcrc.com';
const RHYTHM_API_TOKEN = process.env.RHYTHM_API_TOKEN ?? '';

if (!RHYTHM_API_TOKEN) {
  process.stderr.write(
    'Error: RHYTHM_API_TOKEN environment variable is not set.\n' +
    'Copy your session token from Rhythm Settings → Claude Integration.\n',
  );
  process.exit(1);
}

const server = new McpServer({
  name: 'rhythm',
  version: '0.1.0',
});

// Register all tools
registerPingTool(server, RHYTHM_API_URL, RHYTHM_API_TOKEN);

// Connect over stdio (Claude Desktop / Claude Code MCP transport)
const transport = new StdioServerTransport();
server.connect(transport).catch((err: unknown) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
