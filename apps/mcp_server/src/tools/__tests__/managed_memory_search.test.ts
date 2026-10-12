import { afterEach, describe, expect, it, vi } from 'vitest';

import { RHYTHM_SECURITY_CONTEXT_META_KEY } from '../../security/security_context.js';
import { registerAgentMemoryTools } from '../agentMemory.js';

type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: true;
};

type Handler = (
  args: Record<string, unknown>,
  extra: unknown,
) => Promise<ToolResult>;

function fixture(options: { managedMemorySearch?: boolean; managedMemorySelector?: boolean } = {
  managedMemorySearch: true,
}) {
  const handlers = new Map<string, Handler>();
  const server = {
    tool(name: string, _description: string, _shape: unknown, handler: Handler) {
      handlers.set(name, handler);
    },
  };
  registerAgentMemoryTools(server as never, 'http://127.0.0.1:4001', 'fixture-token', options);
  return handlers.get('rhythm_search_memory')!;
}

function extra() {
  return {
    _meta: {
      [RHYTHM_SECURITY_CONTEXT_META_KEY]: {
        sdkSessionId: 'sdk-session-1',
        turnId: 'assistant-1',
        agentName: 'build',
        toolCallId: 'call-1',
        proof: {
          version: 1,
          algorithm: 'Ed25519',
          keyId: 'fixture-key',
          issuedAt: 1_800_000_000_000,
          nonce: 'fixture-nonce',
          toolName: 'rhythm_search_memory',
          argumentsHash: 'fixture-arguments-hash',
          signature: 'fixture-signature',
        },
      },
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('S3-A2 managed rhythm_search_memory transport', () => {
  it('uses the private per-call selector and keeps an unmanaged session on the unchanged legacy search path', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith('/agent-memory/search-select')) {
        return new Response(JSON.stringify({ schemaVersion: 1, mode: 'ordinary' }), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      }
      if (url.startsWith('http://127.0.0.1:4001/agent-memory/search?')) {
        return new Response(JSON.stringify({ references: [] }), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`unexpected request ${url}`);
    }));

    const result = await fixture({ managedMemorySelector: true })({ q: 'ordinary evidence' }, extra());

    expect(result.isError).toBeUndefined();
    expect(calls).toEqual([
      'http://127.0.0.1:4001/agent-memory/search-select',
      'http://127.0.0.1:4001/agent-memory/search?q=ordinary+evidence&view=references',
    ]);
  });

  it('uses selector-returned managed bytes without invoking either legacy GET or the fixed global managed route', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      calls.push(String(input));
      return new Response(JSON.stringify({
        schemaVersion: 1,
        mode: 'managed',
        response: { schemaVersion: 1, blocked: false, text: 'final selected bytes' },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }));

    const result = await fixture({ managedMemorySelector: true })({ q: 'managed evidence' }, extra());

    expect(result).toEqual({ content: [{ type: 'text', text: 'final selected bytes' }] });
    expect(calls).toEqual(['http://127.0.0.1:4001/agent-memory/search-select']);
  });

  it('posts only the ALS trusted call and returns finalized bytes unchanged', async () => {
    const finalized = 'directive\n<<<UNTRUSTED_EXTERNAL_CONTENT>>>\n{"exact":true}\n' +
      '<<<END_UNTRUSTED_EXTERNAL_CONTENT>>>\n  ';
    const requests: Array<{ url: string; method: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        method: init?.method ?? 'GET',
        body: JSON.parse(String(init?.body)),
      });
      return new Response(JSON.stringify({ schemaVersion: 1, blocked: false, text: finalized }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }));

    const result = await fixture()({ q: 'evidence', limit: 3 }, extra());

    expect(result).toEqual({ content: [{ type: 'text', text: finalized }] });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      url: 'http://127.0.0.1:4001/agent-memory/search-managed',
      method: 'POST',
    });
    expect(Object.keys(requests[0].body)).toEqual(['trustedCall']);
    expect(requests[0].body.trustedCall).toMatchObject({
      context: {
        sdkSessionId: 'sdk-session-1',
        turnId: 'assistant-1',
        agentName: 'build',
        toolCallId: 'call-1',
      },
      arguments: { q: 'evidence', limit: 3 },
    });
  });

  it('preserves the API block verdict and never runs the legacy GET/scanner fallback', async () => {
    const warning = '[BLOCKED: user-authored agent memory search results contained potential prompt injection. Content not loaded.]';
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      calls.push(String(input));
      return new Response(JSON.stringify({ schemaVersion: 1, blocked: true, text: warning }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }));

    const result = await fixture()({ q: 'evidence' }, extra());

    expect(result).toEqual({
      content: [{ type: 'text', text: warning }],
      isError: true,
    });
    expect(calls).toEqual(['http://127.0.0.1:4001/agent-memory/search-managed']);
  });

  it('fails closed on missing proof or an invalid response without issuing a legacy request', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      calls.push(String(input));
      return new Response(JSON.stringify({ schemaVersion: 1, blocked: false, text: '', extra: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }));
    const handler = fixture();

    const missing = await handler({ q: 'evidence' }, {});
    expect(missing.isError).toBe(true);
    expect(calls).toEqual([]);

    const invalid = await handler({ q: 'evidence' }, extra());
    expect(invalid.isError).toBe(true);
    expect(invalid.content[0].text).toContain('response is invalid');
    expect(calls).toEqual(['http://127.0.0.1:4001/agent-memory/search-managed']);
  });
});
