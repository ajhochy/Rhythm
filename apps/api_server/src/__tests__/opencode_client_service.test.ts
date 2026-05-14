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

  it('createSession returns { id } from res.data.id', async () => {
    const svc = makeService({
      session: {
        create: vi.fn().mockResolvedValue({
          data: { id: 'sdk-session-123' }, request: {}, response: {},
        }),
      },
    });
    expect(await svc.createSession('hello')).toEqual({ id: 'sdk-session-123' });
  });

  it('prompt returns res.data on success and null on error wrapper', async () => {
    const ok = makeService({
      session: {
        prompt: vi.fn().mockResolvedValue({
          data: { info: { id: 'm1' }, parts: [{ type: 'text', text: 'hi' }] },
          request: {}, response: {},
        }),
      },
    });
    const out = await ok.prompt('sid', 'hello');
    expect(out?.info.id).toBe('m1');

    const bad = makeService({
      session: {
        prompt: vi.fn().mockResolvedValue({
          data: undefined,
          error: { data: { message: 'no model' } },
          request: {}, response: {},
        }),
      },
    });
    expect(await bad.prompt('sid', 'hello')).toBeNull();
  });

  it('promptAsync returns true only when no error', async () => {
    const ok = makeService({
      session: { promptAsync: vi.fn().mockResolvedValue({ data: {}, request: {}, response: {} }) },
    });
    expect(await ok.promptAsync('sid', 'hi')).toBe(true);

    const bad = makeService({
      session: {
        promptAsync: vi.fn().mockResolvedValue({
          data: undefined, error: { data: { message: 'fail' } }, request: {}, response: {},
        }),
      },
    });
    expect(await bad.promptAsync('sid', 'hi')).toBe(false);
  });

  it('abortSession returns true when error is absent', async () => {
    const ok = makeService({
      session: { abort: vi.fn().mockResolvedValue({ data: true, request: {}, response: {} }) },
    });
    expect(await ok.abortSession('sid')).toBe(true);

    const bad = makeService({
      session: {
        abort: vi.fn().mockResolvedValue({
          data: undefined, error: { data: { message: 'not found' } }, request: {}, response: {},
        }),
      },
    });
    expect(await bad.abortSession('sid')).toBe(false);
  });
});
