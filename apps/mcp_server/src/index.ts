#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { registerPingTool } from './tools/ping.js';
import { registerTaskTools } from './tools/tasks.js';
import { registerProjectTools } from './tools/projects.js';
import { registerRhythmTools } from './tools/rhythms.js';
import { registerMessageTools } from './tools/messages.js';
import { registerFacilityTools } from './tools/facilities.js';
import { registerDashboardTools } from './tools/dashboard.js';
import { registerClaudeTriggerTools } from './tools/claude_triggers.js';
import { registerAutomationTools } from './tools/automations.js';
import { registerNotificationTools } from './tools/notifications.js';
import { registerGoogleTools } from './tools/google.js';
import { registerPcoTools } from './tools/pco.js';
import { registerAgentScheduleTools } from './tools/agentSchedule.js';
import { registerAgentDelegationTools } from './tools/agentDelegation.js';
import { registerAgentMemoryTools } from './tools/agentMemory.js';
import { registerAgentResearchTools } from './tools/agentResearch.js';

const RHYTHM_API_URL = process.env.RHYTHM_API_URL ?? 'https://api.vcrcapps.com';
const RHYTHM_API_TOKEN = process.env.RHYTHM_API_TOKEN ?? '';
const RHYTHM_AGENT_URL = process.env.RHYTHM_AGENT_URL ?? 'http://localhost:4001';

if (!RHYTHM_API_TOKEN) {
  process.stderr.write(
    'Error: RHYTHM_API_TOKEN environment variable is not set.\n' +
    'Copy your session token from Rhythm Settings → Claude Integration.\n',
  );
  process.exit(1);
}

const server = new McpServer({
  name: 'rhythm',
  version: '0.2.0',
});

// Register all tools
registerPingTool(server, RHYTHM_API_URL, RHYTHM_API_TOKEN);
registerTaskTools(server, RHYTHM_API_URL, RHYTHM_API_TOKEN);
registerProjectTools(server, RHYTHM_API_URL, RHYTHM_API_TOKEN);
registerRhythmTools(server, RHYTHM_API_URL, RHYTHM_API_TOKEN);
registerMessageTools(server, RHYTHM_API_URL, RHYTHM_API_TOKEN);
registerFacilityTools(server, RHYTHM_API_URL, RHYTHM_API_TOKEN);
registerDashboardTools(server, RHYTHM_API_URL, RHYTHM_API_TOKEN);
registerClaudeTriggerTools(server, RHYTHM_API_URL, RHYTHM_API_TOKEN);
registerAutomationTools(server, RHYTHM_API_URL, RHYTHM_API_TOKEN);
registerNotificationTools(server, RHYTHM_AGENT_URL);
registerGoogleTools(server, RHYTHM_API_URL, RHYTHM_API_TOKEN);
registerPcoTools(server, RHYTHM_API_URL, RHYTHM_API_TOKEN);
registerAgentScheduleTools(server, RHYTHM_API_URL, RHYTHM_API_TOKEN);
registerAgentDelegationTools(server, RHYTHM_AGENT_URL, RHYTHM_API_TOKEN);
// #804 — memory lives on the LOCAL agent server (vault-first write + derived
// index on :4001), NOT prod. Route the memory tools at RHYTHM_AGENT_URL so the
// agent and the Flutter memory UI read/write the same local store. Decoupled
// from serverConfig.url per the dual-endpoint rule.
registerAgentMemoryTools(server, RHYTHM_AGENT_URL, RHYTHM_API_TOKEN);
registerAgentResearchTools(server, RHYTHM_API_URL, RHYTHM_API_TOKEN);

// Connect over stdio (Claude Desktop / Claude Code MCP transport)
const transport = new StdioServerTransport();
server.connect(transport).catch((err: unknown) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
