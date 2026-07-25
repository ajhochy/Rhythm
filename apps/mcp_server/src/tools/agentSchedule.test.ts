import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerAgentScheduleTools } from './agentSchedule.js';
import { RHYTHM_SECURITY_CONTEXT_META_KEY } from '../security/security_context.js';

const API_URL = 'http://rhythm.test';
const API_TOKEN = 'test-token';

async function connectScheduleClient(): Promise<{ client: Client; server: McpServer }> {
  const server = new McpServer({ name: 'rhythm-schedule-test', version: '1.0.0' });
  registerAgentScheduleTools(server, API_URL, API_TOKEN);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'schedule-client', version: '1.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
}

describe('rhythm_create_scheduled_task agent profile binding', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('issue-0-c1: MCP create forwards agentConfigId', async () => {
    const fetchMock = vi.fn(async (input: string | URL) =>
      String(input).endsWith('/agent-approvals/consume')
        ? new Response(JSON.stringify({ allowed: true, consumed: false }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        : new Response(JSON.stringify({ id: 'scheduled-1' }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { client, server } = await connectScheduleClient();
    try {
      await client.callTool({
        name: 'rhythm_create_scheduled_task',
        arguments: {
          name: 'MarcoKaz YouTube Monitor — AI Trend Researcher',
          prompt: 'Monitor the channel',
          scheduleType: 'daily',
          scheduledTime: '09:00',
          agentConfigId: 'AI-Trend-Researcher',
        },
        _meta: {
          [RHYTHM_SECURITY_CONTEXT_META_KEY]: {
            sdkSessionId: 'sdk-schedule-test',
            turnId: 'turn-schedule-test',
            agentName: 'daily-briefing',
            toolCallId: 'call-schedule-test',
          },
        },
      });

      const apiCalls = fetchMock.mock.calls.filter(
        ([input]) => !String(input).endsWith('/agent-approvals/consume'),
      );
      expect(apiCalls).toHaveLength(1);
      const init = apiCalls[0][1] as RequestInit;
      expect(JSON.parse(String(init.body))).toMatchObject({
        agentConfigId: 'AI-Trend-Researcher',
      });
    } finally {
      await client.close();
      await server.close();
    }
  });
});
