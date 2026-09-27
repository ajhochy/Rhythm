/**
 * Live acceptance gate: actual sandbox API + actual fork engine + disposable
 * OpenAI-compatible provider. Never run against ports 4001/4002/4096.
 */
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const API = process.env.RHYTHM_LIVE_URL ?? 'http://127.0.0.1:7398';
const ENGINE = process.env.RHYTHM_LIVE_ENGINE_URL ?? 'http://127.0.0.1:7397';
const CONFIG = process.env.RHYTHM_SANDBOX_OPENCODE_JSON ?? '';
const describeLive = LIVE ? describe : describe.skip;
const PROVIDER_ID = `custom-provider-e2e-${process.pid}`;
const SYNTHETIC_KEY = `synthetic-e2e-${process.pid}`;

describeLive('native custom provider live E2E', () => {
  let fake: Server;
  let baseURL = '';
  const providerRequests: Array<{ url: string | undefined; authorization: string | undefined }> = [];

  beforeAll(async () => {
    if (!CONFIG) throw new Error('RHYTHM_SANDBOX_OPENCODE_JSON must point inside the disposable sandbox');
    const health = await fetch(`${API}/opencode/health`);
    if (!health.ok) throw new Error(`sandbox API is not ready at ${API}`);
    fake = createServer((req, res) => {
      providerRequests.push({ url: req.url, authorization: req.headers.authorization });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ data: [{ id: 'e2e-alpha' }, { id: 'e2e-beta' }] }));
    });
    await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve));
    const address = fake.address();
    if (!address || typeof address === 'string') throw new Error('fake provider failed to bind');
    baseURL = `http://127.0.0.1:${address.port}/v1`;
  });

  afterAll(async () => {
    if (fake) await new Promise<void>((resolve) => fake.close(() => resolve()));
  });

  it('tests, saves, reloads, and publishes discovered models through the real engine catalog without persisting the key', async () => {
    const beforeHealth = await fetch(`${ENGINE}/global/health`).then((response) => response.json()) as { bootId: string };
    const beforeCatalog = await fetch(`${API}/agents/models/catalog/full`).then((response) => response.json()) as Array<{ provider?: string; modelId?: string }>;
    const retained = beforeCatalog.find((row) => row.provider && row.modelId);
    const input = { providerId: PROVIDER_ID, name: 'Disposable E2E Provider', baseURL, apiKey: SYNTHETIC_KEY };
    const tested = await fetch(`${API}/opencode/providers/test`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
    });
    expect(tested.status).toBe(200);
    expect(await tested.json()).toEqual({
      ok: true, providerId: PROVIDER_ID, modelCount: 2,
      models: [{ id: 'e2e-alpha', name: 'e2e-alpha' }, { id: 'e2e-beta', name: 'e2e-beta' }],
    });

    const saved = await fetch(`${API}/opencode/providers`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
    });
    const savedBody = await saved.json();
    expect(saved.status, JSON.stringify(savedBody)).toBe(200);
    expect(savedBody).toEqual({ ok: true, providerId: PROVIDER_ID, modelCount: 2 });

    const catalogResponse = await fetch(`${API}/agents/models/catalog/full`);
    expect(catalogResponse.status).toBe(200);
    const catalog = await catalogResponse.json() as Array<{ provider?: string; modelId?: string }>;
    expect(catalog).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: PROVIDER_ID, modelId: 'e2e-alpha' }),
      expect.objectContaining({ provider: PROVIDER_ID, modelId: 'e2e-beta' }),
    ]));

    const config = readFileSync(CONFIG, 'utf8');
    expect(config).toContain(PROVIDER_ID);
    expect(config).not.toContain(SYNTHETIC_KEY);
    expect(providerRequests.every((request) => request.url === '/v1/models')).toBe(true);
    expect(providerRequests.filter((request) => request.authorization === `Bearer ${SYNTHETIC_KEY}`).length).toBeGreaterThanOrEqual(2);
    const afterHealth = await fetch(`${ENGINE}/global/health`).then((response) => response.json()) as { bootId: string };
    expect(afterHealth.bootId).toBe(beforeHealth.bootId);
    if (retained) expect(catalog).toContainEqual(expect.objectContaining(retained));
    console.info(JSON.stringify({
      receipt: 'custom-provider-live-e2e',
      bootIdBefore: beforeHealth.bootId,
      bootIdAfter: afterHealth.bootId,
      providerId: PROVIDER_ID,
      modelCount: 2,
      retainedCatalogEntry: Boolean(retained),
    }));
  }, 30_000);
});
