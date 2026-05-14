import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpencodeClientService } from '../services/opencode_client_service';

function makeService(stubClient: Record<string, unknown>): OpencodeClientService {
  const svc = new OpencodeClientService();
  // Bypass initialize() by injecting the client and marking ready.
  (svc as unknown as { client: unknown }).client = stubClient;
  (svc as unknown as { status: string }).status = 'ready';
  return svc;
}

describe('OpencodeClientService — SDK response unwrap (.data)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('listProviders unwraps res.data.providers, not res.providers', async () => {
    const svc = makeService({
      config: {
        providers: vi.fn().mockResolvedValue({
          data: { providers: [{ id: 'anthropic' }, { id: 'openrouter' }] },
          request: {},
          response: {},
        }),
      },
    });
    const out = await svc.listProviders();
    expect(out).toEqual(['anthropic', 'openrouter']);
  });

  it('listProviders returns [] when res.data is undefined', async () => {
    const svc = makeService({
      config: {
        providers: vi.fn().mockResolvedValue({ data: undefined, request: {}, response: {} }),
      },
    });
    expect(await svc.listProviders()).toEqual([]);
  });

  it('listProviders returns [] when the SDK throws', async () => {
    const svc = makeService({
      config: { providers: vi.fn().mockRejectedValue(new Error('boom')) },
    });
    expect(await svc.listProviders()).toEqual([]);
  });
});
