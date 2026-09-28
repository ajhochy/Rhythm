import { describe, expect, it, vi } from 'vitest';
import type { OpencodeClient } from '@opencode-ai/sdk';
import { OpencodeClientService } from '../services/opencode_client_service';

function serviceWithoutUserAuth(): OpencodeClientService {
  const service = new OpencodeClientService();
  service.__setTestAuthedProviders([]);
  return service;
}

describe('issue-1572 provider snapshot contract', () => {
  it('issue-1572-c11: shares one engine call, exports capabilities but not credentials or options', async () => {
    const service = serviceWithoutUserAuth();
    const providers = vi.fn().mockResolvedValue({ data: {
      providers: [{ id: 'sample', api: 'http://127.0.0.1:6797/v1', options: { apiKey: 'never-serialize' },
        models: { 'chat-1': { id: 'chat-1', name: 'Chat', capabilities: { input: { text: true }, output: { text: true }, toolcall: true }, status: 'active', limit: { context: 8192 } } } }],
      default: { sample: 'chat-1' },
    } });
    service.__setTestClient({ config: { providers } } as unknown as OpencodeClient);
    const [first, second] = await Promise.all([service.providerSnapshot(), service.providerSnapshot()]);
    expect(providers).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
    expect(JSON.stringify(first)).not.toContain('never-serialize');
    expect(first.providers[0].models[0]).toEqual(expect.objectContaining({ id: 'chat-1', contextLimit: 8192 }));
  });

  it('issue-1572-c12: failed engine reads are not cached', async () => {
    const service = serviceWithoutUserAuth();
    const providers = vi.fn().mockRejectedValueOnce(new Error('unavailable')).mockResolvedValue({ data: { providers: [] } });
    service.__setTestClient({ config: { providers } } as unknown as OpencodeClient);
    await expect(service.providerSnapshot()).rejects.toThrow();
    await expect(service.providerSnapshot()).resolves.toEqual(expect.objectContaining({ providers: [] }));
    expect(providers).toHaveBeenCalledTimes(2);
  });

  it('issue-1572-c9: stalled engine request times out and retries rather than publishing guessed inventory', async () => {
    const service = serviceWithoutUserAuth();
    const providers = vi.fn().mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValueOnce({ data: { providers: [] } });
    service.__setTestClient({ config: { providers } } as unknown as OpencodeClient);
    await expect(service.providerSnapshot()).rejects.toThrow('engine_unverified');
    expect(await service.providerSnapshot()).toEqual({ providers: [], defaults: {} });
    expect(providers).toHaveBeenCalledTimes(2);
  });

  it('issue-1572-c11: endpoint origin and digest omit model API credentials', async () => {
    const service = serviceWithoutUserAuth();
    const providers = vi.fn().mockResolvedValue({ data: { providers: [{
      id: 'mesh', options: { apiKey: 'private-key' },
      models: { chat: { id: 'chat', api: { id: 'actual-api-id', url: 'http://127.0.0.1:6711/v1' },
        capabilities: { input: { text: true }, output: { text: true }, toolcall: true } } },
    }] } });
    service.__setTestClient({ config: { providers } } as unknown as OpencodeClient);
    const result = await service.providerSnapshot();
    expect(result.providers[0]).toEqual(expect.objectContaining({ endpoint: 'http://127.0.0.1:6711', digest: expect.any(String) }));
    expect(result.providers[0].models[0]).toEqual(expect.objectContaining({ apiId: 'actual-api-id', capabilities: { input: { text: true }, output: { text: true }, toolcall: true } }));
    expect(JSON.stringify(result)).not.toContain('private-key');
  });

  it('issue-1572-c17: effective provider option changes alter only the opaque digest', async () => {
    const service = serviceWithoutUserAuth();
    const providers = vi.fn()
      .mockResolvedValueOnce({ data: { providers: [{ id: 'mesh', options: {
        baseURL: 'http://127.0.0.1:6711/v1', apiKey: 'first-private-key',
      }, models: {} }] } })
      .mockResolvedValueOnce({ data: { providers: [{ id: 'mesh', options: {
        baseURL: 'http://127.0.0.1:6712/v1', apiKey: 'second-private-key',
      }, models: {} }] } });
    service.__setTestClient({ config: { providers } } as unknown as OpencodeClient);

    const first = await service.providerSnapshot();
    const second = await service.providerSnapshot();
    expect(first.providers[0].digest).not.toBe(second.providers[0].digest);
    expect(JSON.stringify([first, second])).not.toContain('private-key');
    expect(JSON.stringify([first, second])).not.toContain('baseURL');
  });

  it('1572:1572-S1:17 exposes only the effective endpoint origin and provider source as probe trust metadata', async () => {
    const service = serviceWithoutUserAuth();
    const providers = vi.fn().mockResolvedValue({ data: { providers: [{
      id: 'mesh',
      source: 'config',
      options: {
        baseURL: 'http://localhost:7487/v1',
        apiKey: 'synthetic-secret',
      },
      models: {
        chat: {
          id: 'chat',
          api: { id: 'chat', url: '' },
          capabilities: { input: { text: true }, output: { text: true }, toolcall: true },
        },
      },
    }] } });
    service.__setTestClient({ config: { providers } } as unknown as OpencodeClient);

    const result = await service.providerSnapshot();
    expect(result.providers[0]).toEqual(expect.objectContaining({
      source: 'config', endpoint: 'http://localhost:7487',
    }));
    expect(JSON.stringify(result)).not.toContain('synthetic-secret');
    expect(JSON.stringify(result)).not.toContain('/v1');
  });

  it.each([
    ['config metadata only', 'config', {}, false],
    ['options apiKey', 'config', { apiKey: 'synthetic-secret' }, true],
    ['environment credential', 'env', {}, true],
  ])('review:review-findings.md:84 snapshots credential evidence consistently for the resolver: %s', async (_name, source, options, connected) => {
    const service = serviceWithoutUserAuth();
    const providers = vi.fn().mockResolvedValue({ data: { providers: [{
      id: 'openai', source, options, models: {},
    }] } });
    service.__setTestClient({ config: { providers } } as unknown as OpencodeClient);

    expect((await service.providerSnapshot()).providers[0]).toEqual(expect.objectContaining({
      id: 'openai', connected,
    }));
  });
});
