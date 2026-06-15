/**
 * SDK-boundary regression tests.
 *
 * These guard two false-green bugs that shipped because the hand-written
 * `@types/opencode-ai-sdk.d.ts` declared shapes that did NOT match the real
 * v1.14.49 SDK, and the existing tests mocked ABOVE the SDK boundary (stubbing
 * service methods / the bridge) so they never exercised the real client call:
 *
 *  1. `listAgents` called a non-existent top-level `client.agents(...)`.
 *     The real SDK exposes it as `client.app.agents(...)` (class App).
 *     Runtime symptom: `TypeError: client.agents is not a function`.
 *
 *  2. `subscribeToEvents` treated `client.event.subscribe()` as the hey-api
 *     `{ data, error }` envelope and returned `raw.data`. The real SDK returns
 *     a ServerSentEventsResult = `{ stream }` directly (no `.data`), so the
 *     wrapper always saw `undefined` → "No event stream available" → the agent
 *     transcript never streamed.
 *
 * Both fakes below use the REAL SDK shapes, so these tests fail against the
 * pre-fix code (old code reads `client.agents` — absent here — and `raw.data`
 * — absent here).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpencodeClientService } from '../services/opencode_client_service';

/** Inject a fake client into the private fields, marking the service ready. */
function injectClient(svc: OpencodeClientService, client: unknown) {
  (svc as unknown as Record<string, unknown>)['status'] = 'ready';
  (svc as unknown as Record<string, unknown>)['client'] = client;
}

describe('SDK boundary: listAgents calls client.app.agents (not top-level client.agents)', () => {
  let svc: OpencodeClientService;

  beforeEach(() => {
    svc = new OpencodeClientService();
  });

  it('invokes client.app.agents with the directory query and returns the data array', async () => {
    const agentsFn = vi
      .fn()
      .mockResolvedValue({ data: [{ name: 'plan', mode: 'primary', builtIn: true }] });
    // Real shape: agents lives under the `app` namespace. There is NO
    // top-level `client.agents` — accessing it would be a TypeError, exactly
    // the runtime failure this guards.
    const client = { app: { agents: agentsFn } };
    injectClient(svc, client);

    const result = await svc.listAgents('/Users/ajhochhalter');

    expect(agentsFn).toHaveBeenCalledWith({
      query: { directory: '/Users/ajhochhalter' },
    });
    expect(result).toEqual([{ name: 'plan', mode: 'primary', builtIn: true }]);
  });

  it('does not depend on a top-level client.agents method existing', async () => {
    const client = { app: { agents: vi.fn().mockResolvedValue({ data: [] }) } };
    injectClient(svc, client);
    // Would throw "client.agents is not a function" on the pre-fix code.
    await expect(svc.listAgents()).resolves.toEqual([]);
  });
});

describe('SDK boundary: subscribeToEvents consumes the { stream } SSE result (not a { data } envelope)', () => {
  let svc: OpencodeClientService;

  beforeEach(() => {
    svc = new OpencodeClientService();
  });

  it('returns the result carrying .stream when event.subscribe resolves to { stream } (no .data field)', async () => {
    async function* fakeStream() {
      // empty async iterable — shape is what matters
    }
    const sse = { stream: fakeStream() }; // ServerSentEventsResult shape
    const subscribe = vi.fn().mockResolvedValue(sse);
    const client = { event: { subscribe } };
    injectClient(svc, client);

    const result = await svc.subscribeToEvents('/Users/ajhochhalter');

    expect(subscribe).toHaveBeenCalledWith({
      query: { directory: '/Users/ajhochhalter' },
    });
    // Must NOT be null — the pre-fix code returned `raw.data` (undefined here)
    // and therefore null, which surfaced as "No event stream available".
    expect(result).not.toBeNull();
    expect(result?.stream).toBe(sse.stream);
  });

  it('returns null only when the SSE result genuinely lacks a stream', async () => {
    const subscribe = vi.fn().mockResolvedValue({});
    injectClient(svc, { event: { subscribe } });
    const result = await svc.subscribeToEvents();
    expect(result).toBeNull();
  });
});
