/**
 * Guard test for issue #864 (MCP stateless-readiness audit).
 *
 * Protects two assumptions documented in
 * docs/ai/decisions/2026-07-02-mcp-stateless-readiness.md:
 *
 *   1. Tool registration is order-independent and produces no duplicate
 *      tool names. The server statically registers ~18 tool groups at
 *      startup (see src/index.ts); if two groups ever collide on a name,
 *      the SDK silently lets the later registration win (Map keyed by
 *      name), which would be a silent regression, not a crash. This test
 *      registers all groups against a REAL McpServer (not a stub) and
 *      fails loudly on any collision, in the current import order AND in
 *      reverse order.
 *   2. The server advertises `tools.listChanged: true` — the SDK's default
 *      for any McpServer with `.tool()` registrations — even though Rhythm
 *      never actually sends a listChanged notification (the tool set is
 *      fixed for the lifetime of the stdio process). This is exactly the
 *      kind of a implicit capability claim the new MCP spec's stricter
 *      tool-list-caching rules would care about, so we pin it explicitly
 *      rather than let it drift unnoticed.
 *
 * Uses the SDK's real Client/Server pair over InMemoryTransport (not a
 * hand-rolled stub) so the assertions reflect actual wire-level capability
 * negotiation, not our own mock's behavior.
 */
import { describe, it, expect } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { registerPingTool } from '../tools/ping.js';
import { registerTaskTools } from '../tools/tasks.js';
import { registerProjectTools } from '../tools/projects.js';
import { registerRhythmTools } from '../tools/rhythms.js';
import { registerMessageTools } from '../tools/messages.js';
import { registerFacilityTools } from '../tools/facilities.js';
import { registerDashboardTools } from '../tools/dashboard.js';
import { registerClaudeTriggerTools } from '../tools/claude_triggers.js';
import { registerAutomationTools } from '../tools/automations.js';
import { registerNotificationTools } from '../tools/notifications.js';
import { registerGoogleTools } from '../tools/google.js';
import { registerPcoTools } from '../tools/pco.js';
import { registerAgentScheduleTools } from '../tools/agentSchedule.js';
import { registerAgentDelegationTools } from '../tools/agentDelegation.js';
import { registerAgentMemoryTools } from '../tools/agentMemory.js';
import { registerAgentSessionTools } from '../tools/agentSessions.js';
import { registerAgentApprovalTools } from '../tools/agentApprovals.js';
import { registerFeedbackSensorTools } from '../tools/feedbackSensors.js';
import { registerAgentProfileTools } from '../tools/agentProfiles.js';
import { registerCreativePlatformTools } from '../tools/creativePlatform.js';
import { registerSetupReadinessTool } from '../tools/setupReadiness.js';
import { registerAgentResearchTools } from '../tools/agentResearch.js';
import { registerOrgOptimizerTools } from '../tools/orgOptimizer.js';

const API_URL = 'http://x.invalid';
const API_TOKEN = 'test-token';
const AGENT_URL = 'http://localhost:4001';

/** Mirrors the exact set of register*Tools calls in src/index.ts. */
type Registrar = (server: McpServer) => void;

const REGISTRARS_IN_INDEX_ORDER: Registrar[] = [
  (s) => registerPingTool(s, API_URL, API_TOKEN),
  (s) => registerTaskTools(s, API_URL, API_TOKEN),
  (s) => registerProjectTools(s, API_URL, API_TOKEN),
  (s) => registerRhythmTools(s, API_URL, API_TOKEN),
  (s) => registerMessageTools(s, API_URL, API_TOKEN, AGENT_URL),
  (s) => registerFacilityTools(s, API_URL, API_TOKEN),
  (s) => registerDashboardTools(s, API_URL, API_TOKEN),
  (s) => registerClaudeTriggerTools(s, API_URL, API_TOKEN),
  (s) => registerAutomationTools(s, API_URL, API_TOKEN),
  (s) => registerNotificationTools(s, AGENT_URL),
  (s) => registerGoogleTools(s, API_URL, API_TOKEN, AGENT_URL),
  (s) => registerPcoTools(s, API_URL, API_TOKEN),
  (s) => registerAgentScheduleTools(s, API_URL, API_TOKEN),
  (s) => registerAgentDelegationTools(s, AGENT_URL, API_TOKEN),
  (s) => registerAgentMemoryTools(s, AGENT_URL, API_TOKEN),
  (s) => registerAgentSessionTools(s, AGENT_URL, API_TOKEN),
  (s) => registerAgentApprovalTools(s, AGENT_URL),
  (s) => registerFeedbackSensorTools(s, API_URL, API_TOKEN),
  (s) => registerAgentProfileTools(s, AGENT_URL),
  (s) => registerCreativePlatformTools(s, AGENT_URL),
  (s) => registerSetupReadinessTool(s, AGENT_URL),
  (s) => registerAgentResearchTools(s, API_URL, API_TOKEN),
  (s) => registerOrgOptimizerTools(s, AGENT_URL, API_TOKEN),
];

/** Builds a fresh McpServer, applies `registrars` in order, and returns it. */
function buildServer(registrars: Registrar[]): McpServer {
  const server = new McpServer({ name: 'rhythm', version: '0.2.0-test' });
  for (const register of registrars) {
    register(server);
  }
  return server;
}

/** Connects a real Client to `server` over an in-memory transport pair. */
async function connectClient(server: McpServer): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return client;
}

function assertNoDuplicateNames(names: string[]) {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const name of names) {
    if (seen.has(name)) duplicates.push(name);
    seen.add(name);
  }
  expect(duplicates, `duplicate tool names: ${duplicates.join(', ')}`).toEqual([]);
}

describe('MCP server tool registration (issue #864 guard)', () => {
  it('registers every tool group with no duplicate tool names, in declared (index.ts) order', async () => {
    const server = buildServer(REGISTRARS_IN_INDEX_ORDER);
    const client = await connectClient(server);
    try {
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(83);
      assertNoDuplicateNames(tools.map((t) => t.name));
    } finally {
      await client.close();
    }
  });

  it('produces the same tool set regardless of registration order (order-independence)', async () => {
    const forward = buildServer(REGISTRARS_IN_INDEX_ORDER);
    const reversed = buildServer([...REGISTRARS_IN_INDEX_ORDER].reverse());

    const forwardClient = await connectClient(forward);
    const reversedClient = await connectClient(reversed);
    try {
      const [forwardTools, reversedTools] = await Promise.all([
        forwardClient.listTools(),
        reversedClient.listTools(),
      ]);

      assertNoDuplicateNames(reversedTools.tools.map((t) => t.name));

      const forwardNames = new Set(forwardTools.tools.map((t) => t.name));
      const reversedNames = new Set(reversedTools.tools.map((t) => t.name));
      expect(reversedNames).toEqual(forwardNames);
    } finally {
      await forwardClient.close();
      await reversedClient.close();
    }
  });

  it('advertises tools.listChanged: true, matching the documented (static-tool-list) assumption', async () => {
    const server = buildServer(REGISTRARS_IN_INDEX_ORDER);
    const client = await connectClient(server);
    try {
      // Force capability negotiation to complete.
      await client.listTools();
      const capabilities = client.getServerCapabilities();
      expect(capabilities?.tools?.listChanged).toBe(true);
    } finally {
      await client.close();
    }
  });
});
