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
import { registerAgentSessionTools } from './tools/agentSessions.js';
import { registerAgentResearchTools } from './tools/agentResearch.js';
import { registerOrgOptimizerTools } from './tools/orgOptimizer.js';
import { registerAgentApprovalTools } from './tools/agentApprovals.js';
import { registerFeedbackSensorTools } from './tools/feedbackSensors.js';
import { registerAgentProfileTools } from './tools/agentProfiles.js';
import { registerCreativePlatformTools } from './tools/creativePlatform.js';
import { registerSetupReadinessTool } from './tools/setupReadiness.js';

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
// #1134 — send/create-thread need RHYTHM_AGENT_URL to verify approval ids
// against /agent-approvals when the session is tainted by untrusted content.
registerMessageTools(server, RHYTHM_API_URL, RHYTHM_API_TOKEN, RHYTHM_AGENT_URL);
registerFacilityTools(server, RHYTHM_API_URL, RHYTHM_API_TOKEN);
registerDashboardTools(server, RHYTHM_API_URL, RHYTHM_API_TOKEN);
registerClaudeTriggerTools(server, RHYTHM_API_URL, RHYTHM_API_TOKEN);
registerAutomationTools(server, RHYTHM_API_URL, RHYTHM_API_TOKEN);
registerNotificationTools(server, RHYTHM_AGENT_URL);
// #1134 — rhythm_send_email needs RHYTHM_AGENT_URL to verify approval ids
// against /agent-approvals when the session is tainted by untrusted content.
registerGoogleTools(server, RHYTHM_API_URL, RHYTHM_API_TOKEN, RHYTHM_AGENT_URL);
registerPcoTools(server, RHYTHM_API_URL, RHYTHM_API_TOKEN);
registerAgentScheduleTools(server, RHYTHM_API_URL, RHYTHM_API_TOKEN);
registerAgentDelegationTools(server, RHYTHM_AGENT_URL, RHYTHM_API_TOKEN);
// #804 — memory lives on the LOCAL agent server (vault-first write + derived
// index on :4001), NOT prod. Route the memory tools at RHYTHM_AGENT_URL so the
// agent and the Flutter memory UI read/write the same local store. Decoupled
// from serverConfig.url per the dual-endpoint rule.
registerAgentMemoryTools(server, RHYTHM_AGENT_URL, RHYTHM_API_TOKEN);
// #806 — rhythm_list_sessions reads agent sessions/messages from the LOCAL
// agent server (:4001), the store that owns sessions. The seeded Memory
// Consolidation task calls it to review the past day's sessions before
// distilling facts via rhythm_remember_memory. Routed at RHYTHM_AGENT_URL —
// never serverConfig.url (dual-endpoint rule).
registerAgentSessionTools(server, RHYTHM_AGENT_URL, RHYTHM_API_TOKEN);
// #895 — approval gate state lives on the LOCAL agent server (SQLite, same
// convention as agent_sessions/agent_configs), routed at RHYTHM_AGENT_URL.
registerAgentApprovalTools(server, RHYTHM_AGENT_URL);
// #897 — feedback sensors reuse the prod-facing read endpoints (PCO, Gmail,
// tasks), same routing as the other prod-backed tools above.
registerFeedbackSensorTools(server, RHYTHM_API_URL, RHYTHM_API_TOKEN);
// #911 — profile creation is agent-execution state (agent_configs), routed
// at RHYTHM_AGENT_URL like the other local-agent-server tools above.
registerAgentProfileTools(server, RHYTHM_AGENT_URL);
registerCreativePlatformTools(server, RHYTHM_AGENT_URL);
registerSetupReadinessTool(server, RHYTHM_AGENT_URL);
registerAgentResearchTools(server, RHYTHM_API_URL, RHYTHM_API_TOKEN);
// #850 (org-optimizer-16) — the run-loop trigger is an agent-execution
// surface backed by local SQLite (agent_org_proposals), routed at
// RHYTHM_AGENT_URL like the scheduler/session/memory tools above, never
// serverConfig.url (dual-endpoint rule).
registerOrgOptimizerTools(server, RHYTHM_AGENT_URL, RHYTHM_API_TOKEN);
// #944 — rhythm_create_issue (GitHub) was removed: agents file issues via the
// `gh` CLI in their bash tool, which is already authenticated; the MCP tool
// needed its own token plumbing and duplicated that path.

// Connect over stdio (Claude Desktop / Claude Code MCP transport)
const transport = new StdioServerTransport();
server.connect(transport).catch((err: unknown) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
