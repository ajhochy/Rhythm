import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerAgentMemoryTools } from '../agentMemory';

/**
 * #804 — the memory MCP tools (remember/search/list/forget) must target the
 * LOCAL agent server (RHYTHM_AGENT_URL, default http://localhost:4001), NOT the
 * prod Settings URL. These tests assert the resolved request base is the local
 * server and that pointing the prod URL elsewhere does not move it — the same
 * dual-endpoint invariant agent-sessions hold.
 */

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

class FakeServer {
  registered = new Map<string, ToolHandler>();

  tool(
    name: string,
    _description: string,
    _schema: unknown,
    handler: ToolHandler,
  ) {
    this.registered.set(name, handler);
  }
}

const LOCAL = 'http://localhost:4001';

function buildServer(base: string): FakeServer {
  const server = new FakeServer();
  registerAgentMemoryTools(server as never, base, 'tok-1');
  return server;
}

/** Stub global fetch, capture the URL/body each memory tool actually sends. */
function stubFetch(): { calls: string[]; bodies: unknown[] } {
  const calls: string[] = [];
  const bodies: unknown[] = [];
  const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
    calls.push(String(url));
    bodies.push(
      typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body,
    );
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, id: 'mem-1', results: [] }),
    } as unknown as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, bodies };
}

describe('#804 memory MCP tools resolve to the local agent server', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('rhythm_remember_memory POSTs to localhost:4001, not prod', async () => {
    const { calls } = stubFetch();
    const server = buildServer(LOCAL);
    const handler = server.registered.get('rhythm_remember_memory');
    expect(handler).toBeDefined();

    await handler!({ content: 'remember this', kind: 'note' });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe(`${LOCAL}/agent-memory`);
    expect(calls[0].startsWith(LOCAL)).toBe(true);
    expect(calls[0]).not.toContain('vcrcapps.com');
  });

  it('rhythm_search_memory GETs from localhost:4001', async () => {
    const { calls } = stubFetch();
    const server = buildServer(LOCAL);
    const handler = server.registered.get('rhythm_search_memory');
    expect(handler).toBeDefined();

    await handler!({ q: 'project x' });

    expect(calls).toHaveLength(1);
    expect(calls[0].startsWith(`${LOCAL}/agent-memory/search`)).toBe(true);
    expect(calls[0]).not.toContain('vcrcapps.com');
  });

  it('rhythm_remember_memory threads known source-session context unchanged', async () => {
    const { bodies } = stubFetch();
    const server = buildServer(LOCAL);
    const handler = server.registered.get('rhythm_remember_memory');

    await handler!({
      content: 'remember this',
      kind: 'fact',
      sessionId: 'source-session-42',
    });

    expect(bodies[0]).toMatchObject({
      content: 'remember this',
      sessionId: 'source-session-42',
    });
  });

  it('rhythm_list_memories GETs from localhost:4001', async () => {
    const { calls } = stubFetch();
    const server = buildServer(LOCAL);
    const handler = server.registered.get('rhythm_list_memories');
    expect(handler).toBeDefined();

    await handler!({ kind: 'fact' });

    expect(calls).toHaveLength(1);
    expect(calls[0].startsWith(`${LOCAL}/agent-memory`)).toBe(true);
    expect(calls[0]).not.toContain('vcrcapps.com');
  });

  it('rhythm_forget_memory DELETEs against localhost:4001', async () => {
    const { calls } = stubFetch();
    const server = buildServer(LOCAL);
    const handler = server.registered.get('rhythm_forget_memory');
    expect(handler).toBeDefined();

    await handler!({ id: 'mem-1' });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe(`${LOCAL}/agent-memory/mem-1`);
    expect(calls[0]).not.toContain('vcrcapps.com');
  });

  it('rhythm_update_memory PATCHes against localhost:4001 (#862)', async () => {
    const { calls } = stubFetch();
    const server = buildServer(LOCAL);
    const handler = server.registered.get('rhythm_update_memory');
    expect(handler).toBeDefined();

    await handler!({ id: 'mem-1', content: 'edited content' });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe(`${LOCAL}/agent-memory/mem-1`);
    expect(calls[0]).not.toContain('vcrcapps.com');
  });

  it('rhythm_verify_memory uses the fixed local agent-lifecycle endpoint (#1190)', async () => {
    const { calls } = stubFetch();
    const server = buildServer(LOCAL);
    const handler = server.registered.get('rhythm_verify_memory');
    expect(handler).toBeDefined();

    await handler!({
      id: 'mem-1',
      action: 'verify',
      staleAfter: '2026-10-01',
      by: 'human:forged@example.com',
    });

    expect(calls).toEqual([
      `${LOCAL}/agent-memory/mem-1/agent-lifecycle`,
    ]);
  });

  it('prod-URL invariant: the base passed to the tools is the only thing that moves the request — index.ts wires RHYTHM_AGENT_URL, never serverConfig.url', async () => {
    // The tools have no knowledge of the prod Settings URL; their base is
    // injected by the caller. index.ts injects RHYTHM_AGENT_URL (local). To
    // prove the decoupling: a server built with the local base hits local even
    // if a *different* (prod) base exists in the environment.
    const { calls } = stubFetch();
    const prevApi = process.env.RHYTHM_API_URL;
    process.env.RHYTHM_API_URL = 'https://api.vcrcapps.com';
    try {
      const server = buildServer(LOCAL);
      const handler = server.registered.get('rhythm_remember_memory');
      await handler!({ content: 'x' });
      // Changing the prod URL env did not move the memory request off local.
      expect(calls[0]).toBe(`${LOCAL}/agent-memory`);
      expect(calls[0]).not.toContain('vcrcapps.com');
    } finally {
      if (prevApi === undefined) delete process.env.RHYTHM_API_URL;
      else process.env.RHYTHM_API_URL = prevApi;
    }
  });
});
