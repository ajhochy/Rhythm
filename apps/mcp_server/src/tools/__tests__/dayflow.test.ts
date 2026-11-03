import { afterEach, describe, expect, it, vi } from 'vitest';
import { RHYTHM_SECURITY_CONTEXT_META_KEY } from '../../security/security_context.js';
import { registerDayflowTools } from '../dayflow.js';

type Handler = (args: Record<string, unknown>, extra: unknown) => Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: true }>;
function fixture() { const handlers = new Map<string, Handler>(); registerDayflowTools({ tool: (name: string, _d: string, _s: unknown, handler: Handler) => handlers.set(name, handler) } as never, 'http://127.0.0.1:4001', 'token'); return handlers; }
function extra() { return { _meta: { [RHYTHM_SECURITY_CONTEXT_META_KEY]: { sdkSessionId: 'sdk-1', turnId: 'turn-1', agentName: 'agent', toolCallId: 'call-1', proof: { version: 1, algorithm: 'Ed25519', keyId: 'key', issuedAt: 1, nonce: 'nonce', toolName: 'rhythm_search_dayflow_activity', argumentsHash: 'hash', signature: 'signature' } } } }; }
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('managed Dayflow MCP readers', () => {
  it('registers exact names and posts the signed scoped call to the two local endpoints', async () => {
    const handlers = fixture(); const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => { requests.push({ url, body: JSON.parse(String(init?.body)) }); return new Response(JSON.stringify({ schemaVersion: 1, status: 'available', text: '<<<UNTRUSTED_EXTERNAL_CONTENT>>>evidence<<<END_UNTRUSTED_EXTERNAL_CONTENT>>>', blocked: false }), { status: 200 }); }));
    await handlers.get('rhythm_search_dayflow_activity')!({ q: 'handoff', limit: 3 }, extra());
    await handlers.get('rhythm_recent_dayflow_summaries')!({ limit: 2 }, extra());
    expect([...handlers.keys()].sort()).toEqual(['rhythm_recent_dayflow_summaries', 'rhythm_search_dayflow_activity']);
    expect(requests.map((request) => request.url)).toEqual(['http://127.0.0.1:4001/dayflow-agent/activity/search', 'http://127.0.0.1:4001/dayflow-agent/activity/recent-summaries']);
    expect(requests[0].body).toEqual({ trustedCall: expect.objectContaining({ arguments: { q: 'handoff', limit: 3 } }) });
    expect(requests[1].body).toEqual({ trustedCall: expect.objectContaining({ arguments: { limit: 2 } }) });
  });

  it('does not request without trusted context and does not reveal raw errors', async () => {
    const handler = fixture().get('rhythm_search_dayflow_activity')!; const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    expect(await handler({ q: 'x' }, {})).toEqual({ content: [{ type: 'text', text: 'Dayflow activity is unavailable.' }], isError: true }); expect(fetcher).not.toHaveBeenCalled();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: '/private/secret' } }), { status: 500 })));
    expect(await handler({ q: 'x' }, extra())).toEqual({ content: [{ type: 'text', text: 'Dayflow activity is unavailable.' }], isError: true });
  });

  it('fails closed on malformed, stale, forged, nonavailable-sensitive, and oversized responses', async () => {
    const handler = fixture().get('rhythm_search_dayflow_activity')!;
    for (const payload of [
      { schemaVersion: 2, status: 'available', text: 'evidence', blocked: false },
      { schemaVersion: 1, status: 'available', text: 'evidence', blocked: false, extra: true },
      { schemaVersion: 1, status: 'unavailable', text: 'sensitive source', blocked: false },
      { schemaVersion: 1, status: 'available', text: 'x'.repeat(3_801), blocked: false },
    ]) { vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 }))); expect((await handler({ q: 'x' }, extra())).isError).toBe(true); }
  });
});
