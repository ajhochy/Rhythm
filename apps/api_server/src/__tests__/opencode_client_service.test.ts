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

  it('listModels unwraps res.data.providers[].models', async () => {
    const svc = makeService({
      config: {
        providers: vi.fn().mockResolvedValue({
          data: {
            providers: [
              {
                id: 'anthropic',
                models: [{ id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5' }],
              },
              { id: 'openrouter', models: [] },
            ],
          },
          request: {}, response: {},
        }),
      },
    });
    expect(await svc.listModels('anthropic')).toEqual([
      { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5' },
    ]);
    expect(await svc.listModels('unknown')).toEqual([]);
  });

  it('setAuth returns true only when res.data === true', async () => {
    const ok = makeService({
      auth: { set: vi.fn().mockResolvedValue({ data: true, request: {}, response: {} }) },
    });
    expect(await ok.setAuth('openrouter', 'sk-or-test')).toBe(true);

    const bad = makeService({
      auth: {
        set: vi.fn().mockResolvedValue({
          data: undefined,
          error: { data: { error: [{ message: 'invalid_type' }] }, success: false },
          request: {}, response: {},
        }),
      },
    });
    expect(await bad.setAuth('openrouter', 'sk-or-test')).toBe(false);
  });
});
