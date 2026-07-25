import { describe, expect, it, vi } from 'vitest';
import { registerAgentDelegationTools } from './agentDelegation';

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

class FakeServer {
  registered = new Map<string, ToolHandler>();

  tool(name: string, _description: string, _schema: unknown, handler: ToolHandler) {
    this.registered.set(name, handler);
  }
}

describe('issue #1123 — rhythm_delegate_async MCP tool', () => {
  it('registers the additive tool and returns the immediate dispatch acknowledgement', async () => {
    const server = new FakeServer();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        sessionId: 'local-child',
        status: 'dispatched',
        targetAgentConfigId: 'specialist',
        message: "Dispatched; you'll be notified when it's done.",
      }),
    });
    registerAgentDelegationTools(
      server as never,
      'http://127.0.0.1:4198',
      'token',
      fetchMock as never,
    );

    expect(server.registered.get('rhythm_delegate')).toBeDefined();
    const handler = server.registered.get('rhythm_delegate_async');
    expect(handler).toBeDefined();
    const result = await handler!({
      targetAgentConfigId: 'specialist',
      prompt: 'Work in the background.',
      callerSessionId: 'parent',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:4198/agent-delegation/delegate-async',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(result).toMatchObject({
      content: [{ type: 'text', text: expect.stringContaining("you'll be notified") }],
    });
  });
});
