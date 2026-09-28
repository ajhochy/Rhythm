import { createServer } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { eligibleModel, probeDeclaredModels } from '../services/provider_catalog_policy';

describe('issue-1572 provider policy', () => {
  it('issue-1572-c13: unknown capabilities and deprecated/fast models are unavailable without ID heuristics', () => {
    expect(eligibleModel({ id: 'gpt-chat', status: 'active' })).toBe(false);
    expect(eligibleModel({ id: 'arbitrary', status: 'active', capabilities: { input: { text: true }, output: { text: true }, toolcall: true } })).toBe(true);
    expect(eligibleModel({ id: 'arbitrary-fast', status: 'active', capabilities: { input: { text: true }, output: { text: true }, toolcall: true } })).toBe(false);
    expect(eligibleModel({ id: 'arbitrary', status: 'deprecated', capabilities: { input: { text: true }, output: { text: true }, toolcall: true } })).toBe(false);
  });

  it('1572:1572-S1:14 a real declared loopback model list is intersected without sending credentials', async () => {
    let headers: Record<string, string | string[] | undefined> = {};
    const server = createServer((request, response) => {
      headers = request.headers;
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ data: [{ id: 'listed' }, { id: 'unconfigured' }] }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('expected local port');
      const found = await probeDeclaredModels(`http://127.0.0.1:${address.port}/v1`, `http://127.0.0.1:${address.port}/v1`, new Set(['listed']));
      expect(found).toEqual(new Set(['listed']));
      expect(headers.authorization).toBeUndefined();
    } finally { server.close(); }
  });

  it('1572:1572-S1:15 public, link-local, metadata, userinfo, IPv6 mapping and mismatched origins cannot be probed', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('must not fetch'));
    const rejected: Array<[string, string]> = [
      ['https://example.org/v1', 'https://example.org/v1'],
      ['http://169.254.169.254/v1', 'http://169.254.169.254/v1'],
      ['http://a:b@127.0.0.1:6797/v1', 'http://a:b@127.0.0.1:6797/v1'],
      ['http://127.0.0.1:6798/v1', 'http://127.0.0.1:6797/v1'],
      ['http://127.0.0.1//169.254.169.254/v1', 'http://127.0.0.1//169.254.169.254/v1'],
      ['http://127.0.0.1/\\\\evil.example/v1', 'http://127.0.0.1/\\\\evil.example/v1'],
      ['http://[::ffff:127.0.0.1]/v1', 'http://[::ffff:127.0.0.1]/v1'],
    ];
    for (const [endpoint, trustedEndpoint] of rejected) {
      expect(await probeDeclaredModels(endpoint, trustedEndpoint, new Set(['listed']))).toEqual(new Set());
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('1572:1572-S1:16 refuses redirects and never follows a local inventory to another origin', async () => {
    let requests = 0;
    const server = createServer((_request, response) => {
      requests++;
      response.statusCode = 302;
      response.setHeader('location', 'http://evil.example/v1/models');
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('expected local port');
      expect(await probeDeclaredModels(
        `http://127.0.0.1:${address.port}/v1`,
        `http://127.0.0.1:${address.port}/v1`,
        new Set(['listed']),
      )).toEqual(new Set());
      expect(requests).toBe(1);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
