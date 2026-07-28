import { describe, expect, it, vi } from 'vitest';
import { registerAgentDelegationTools } from './agentDelegation';
import { RHYTHM_SECURITY_CONTEXT_META_KEY } from '../security/security_context.js';

type ToolHandler = (args: Record<string, unknown>, extra?: unknown) => Promise<unknown>;

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
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ allowed: true, consumed: false }),
      })),
    );
    const result = await handler!(
      {
        targetAgentConfigId: 'specialist',
        prompt: 'Work in the background.',
        callerSessionId: 'parent',
      },
      {
        _meta: {
          [RHYTHM_SECURITY_CONTEXT_META_KEY]: {
            sdkSessionId: 'sdk-delegation-test',
            turnId: 'turn-delegation-test',
            agentName: 'manager',
            toolCallId: 'call-delegation-test',
          },
        },
      },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:4198/agent-delegation/delegate-async',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(result).toMatchObject({
      content: [{ type: 'text', text: expect.stringContaining("you'll be notified") }],
    });
  });
});
