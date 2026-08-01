import { describe, expect, it, vi } from 'vitest';

import {
  MobileOpenCodeProxy,
  type MobileOpenCodeProxyOptions,
} from '../services/mobile_opencode_proxy';

describe('issue-1285-c19: mobile prompts start desktop event persistence', () => {
  it('awaits the event bridge before forwarding prompt_async upstream', async () => {
    // Regression caught: after the desktop/API restarts, the global OpenCode
    // event bridge is dormant. A raw mobile prompt reaches the engine, but its
    // messages never persist or broadcast to the desktop client.
    const order: string[] = [];
    const preparePromptStream = vi.fn(async () => {
      order.push('stream');
    });
    const fetchFn = vi.fn(async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const url = new URL(String(input));
      if (url.pathname === '/session' && init?.method === 'GET') {
        return new Response(JSON.stringify([{
          id: 'ses-projectless',
          directory: '/Users/person',
        }]), { headers: { 'Content-Type': 'application/json' } });
      }
      if (url.pathname === '/session/ses-projectless/prompt_async') {
        order.push('prompt');
        return new Response(null, { status: 204 });
      }
      return new Response(JSON.stringify([]), {
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const options = {
      baseUrl: 'http://opencode.test',
      fetchFn,
      ownershipRepository: {
        isResourceOwnedBy: () => true,
        isResourceExplicitlyOwnedBy: () => true,
        claimResource: () => true,
        releaseResource: () => true,
        resolveSessionDirectoryForOwner: () => '/Users/person',
      },
      preparePromptStream,
    } as MobileOpenCodeProxyOptions & {
      preparePromptStream: typeof preparePromptStream;
    };
    const proxy = new MobileOpenCodeProxy(options);

    const result = await proxy.forward({
      method: 'POST',
      path: '/session/ses-projectless/prompt_async',
      query: new URLSearchParams(),
      body: { parts: [{ type: 'text', text: 'Respond ok' }] },
      project: { id: 'routing-project', root: '/routing/project' },
      userId: 1,
    });

    expect(result.status).toBe(204);
    expect(preparePromptStream).toHaveBeenCalledWith({
      directory: '/Users/person',
      projectId: 'routing-project',
      sdkSessionId: 'ses-projectless',
      userId: 1,
    });
    expect(order).toEqual(['stream', 'prompt']);
  });
});
