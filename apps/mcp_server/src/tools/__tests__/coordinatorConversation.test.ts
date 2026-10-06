import { afterEach, describe, expect, it, vi } from 'vitest';

import { RHYTHM_SECURITY_CONTEXT_META_KEY } from '../../security/security_context.js';
import { registerCoordinatorConversationTools } from '../coordinatorConversation.js';

type Handler = (args: Record<string, unknown>, extra: unknown) => Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: true;
}>;

function fixture() {
  const handlers = new Map<string, Handler>();
  registerCoordinatorConversationTools({
    tool: (name: string, _description: string, _shape: unknown, handler: Handler) => handlers.set(name, handler),
  } as never, 'http://127.0.0.1:4001', 'token');
  return handlers;
}

function extra(toolName = 'rhythm_get_coordinator_status') {
  return {
    _meta: {
      [RHYTHM_SECURITY_CONTEXT_META_KEY]: {
        sdkSessionId: 'sdk-1', turnId: 'turn-1', agentName: 'Secretary', toolCallId: 'call-1',
        proof: {
          version: 1, algorithm: 'Ed25519', keyId: 'key', issuedAt: 1, nonce: 'nonce',
          toolName, argumentsHash: 'hash', signature: 'signature',
        },
      },
    },
  };
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('signed coordinator conversation MCP status', () => {
  it('registers one read-only status tool and posts only the signed active-call envelope', async () => {
    const handler = fixture().get('rhythm_get_coordinator_status')!;
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('http://127.0.0.1:4001/coordinator-agent/status');
      expect(JSON.parse(String(init?.body))).toEqual({
        trustedCall: expect.objectContaining({
          context: expect.objectContaining({ sdkSessionId: 'sdk-1', turnId: 'turn-1', toolCallId: 'call-1' }),
          arguments: {},
        }),
      });
      return new Response(JSON.stringify({
        schemaVersion: 1, status: 'available', text: 'Authoritative coordinator status (read-only): {}',
      }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetcher);
    await expect(handler({}, extra())).resolves.toEqual({
      content: [{ type: 'text', text: 'Authoritative coordinator status (read-only): {}' }],
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('fails closed without signed context or on malformed/nonavailable response data', async () => {
    const handler = fixture().get('rhythm_get_coordinator_status')!;
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await expect(handler({}, {})).resolves.toEqual({
      content: [{ type: 'text', text: 'Coordinator status is unavailable.' }], isError: true,
    });
    expect(fetcher).not.toHaveBeenCalled();
    for (const payload of [
      { schemaVersion: 2, status: 'available', text: 'x' },
      { schemaVersion: 1, status: 'unavailable', text: 'sensitive' },
      { schemaVersion: 1, status: 'available', text: 'x'.repeat(3_801) },
      { schemaVersion: 1, status: 'available', text: 'ok', extra: true },
    ]) {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })));
      await expect(handler({}, extra())).resolves.toEqual({
        content: [{ type: 'text', text: 'Coordinator status is unavailable.' }], isError: true,
      });
    }
  });

  it('uses the existing signed async-delegation authorization before posting one exact captured goal', async () => {
    const handler = fixture().get('rhythm_start_coordinator_goal')!;
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      if (url.endsWith('/agent-approvals/consume')) {
        expect(body).toEqual(expect.objectContaining({
          context: expect.objectContaining({ sdkSessionId: 'sdk-1', toolCallId: 'call-1' }),
          action: 'delegation.start-async', payload: { goalId: 'goal-1' },
        }));
        return new Response(JSON.stringify({ allowed: true }), { status: 200 });
      }
      expect(url).toBe('http://127.0.0.1:4001/coordinator-agent/start-goal');
      expect(body).toEqual({
        trustedCall: expect.objectContaining({
          context: expect.objectContaining({ sdkSessionId: 'sdk-1', turnId: 'turn-1', toolCallId: 'call-1' }),
          arguments: { goalId: 'goal-1' },
        }),
      });
      return new Response(JSON.stringify({
        schemaVersion: 1, status: 'started', text: 'Coding Workflow was dispatched for the exact tracked goal.',
      }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetcher);
    await expect(handler({ goalId: 'goal-1' }, extra('rhythm_start_coordinator_goal'))).resolves.toEqual({
      content: [{ type: 'text', text: 'Coding Workflow was dispatched for the exact tracked goal.' }],
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('fails closed at the existing authorization gate without posting a coordinator action', async () => {
    const handler = fixture().get('rhythm_start_coordinator_goal')!;
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ allowed: false }), { status: 403 }));
    vi.stubGlobal('fetch', fetcher);
    await expect(handler({ goalId: 'goal-1' }, extra('rhythm_start_coordinator_goal'))).resolves.toMatchObject({
      isError: true,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe('http://127.0.0.1:4001/agent-approvals/consume');
  });
});
