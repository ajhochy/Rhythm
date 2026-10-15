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

  // Changed expectation (approval-resume repair): the tool no longer runs a
  // generic /agent-approvals/consume preflight that could burn the token before
  // the API proved the native binding. It posts ONLY the signed envelope to the
  // goal action endpoint, which couples consumption with the goal reservation.
  it('posts only the signed envelope to the goal action endpoint, with no consume preflight', async () => {
    const handler = fixture().get('rhythm_start_coordinator_goal')!;
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('http://127.0.0.1:4001/coordinator-agent/start-goal');
      expect(JSON.parse(String(init?.body))).toEqual({
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
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('passes the signed approval id through unchanged and never consumes it itself', async () => {
    const handler = fixture().get('rhythm_start_coordinator_goal')!;
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).not.toContain('/agent-approvals/consume');
      expect(JSON.parse(String(init?.body)).trustedCall.arguments).toEqual({ goalId: 'goal-1', approval_id: 'approval-1' });
      return new Response(JSON.stringify({ schemaVersion: 1, status: 'started', text: 'ok' }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetcher);
    await handler({ goalId: 'goal-1', approval_id: 'approval-1' }, extra('rhythm_start_coordinator_goal'));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('surfaces the missing-approval held response with its exact fixed approval mapping', async () => {
    const handler = fixture().get('rhythm_start_coordinator_goal')!;
    const text = 'Coordinator goal action needs a human approval first. Call rhythm_request_approval with security_action ' +
      '"delegation.start-async" and security_payload {"goalId":"goal-1"} exactly, wait for the human decision, ' +
      'then retry this tool once with its approval_id.';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ schemaVersion: 1, status: 'held', text }), { status: 200 })));
    await expect(handler({ goalId: 'goal-1' }, extra('rhythm_start_coordinator_goal'))).resolves.toEqual({
      content: [{ type: 'text', text }], isError: true,
    });
  });

  it('fails closed without a signed call and on an unavailable/malformed goal response', async () => {
    const handler = fixture().get('rhythm_start_coordinator_goal')!;
    const none = vi.fn();
    vi.stubGlobal('fetch', none);
    await expect(handler({ goalId: 'goal-1' }, {})).resolves.toMatchObject({ isError: true });
    expect(none).not.toHaveBeenCalled();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ schemaVersion: 1, status: 'unavailable', text: 'no' }), { status: 200 })));
    await expect(handler({ goalId: 'goal-1' }, extra('rhythm_start_coordinator_goal'))).resolves.toMatchObject({ isError: true });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    await expect(handler({ goalId: 'goal-1' }, extra('rhythm_start_coordinator_goal'))).resolves.toMatchObject({ isError: true });
  });
});
