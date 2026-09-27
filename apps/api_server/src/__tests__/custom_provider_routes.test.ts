/**
 * Acceptance contract — native OpenCode custom-provider create-only MVP.
 *
 * Regression guarded: a renderer-controlled endpoint must not become an SSRF,
 * secret-reflection, partial-config-write, or false-success surface.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { startTestServer } from './helpers/real_server';
import { validateCustomProviderInput } from '../services/custom_provider_service';

const engine = vi.hoisted(() => ({
  setAuth: vi.fn().mockResolvedValue(true),
  removeAuth: vi.fn().mockResolvedValue(true),
  getGlobalConfig: vi.fn(),
  updateGlobalConfig: vi.fn().mockResolvedValue(true),
  reloadConfig: vi.fn().mockResolvedValue(true),
  providerSnapshot: vi.fn(),
  listProviders: vi.fn().mockResolvedValue([]),
  resetProbeCache: vi.fn(),
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: { isReady: true, ...engine },
}));

type Started = Awaited<ReturnType<typeof startTestServer>>;
type ProviderInput = { providerId: string; name: string; baseURL: string; apiKey?: string };

const valid = (baseURL: string): ProviderInput => ({
  providerId: 'acceptance-provider',
  name: 'Acceptance Provider',
  baseURL,
  apiKey: 'synthetic-custom-provider-key',
});

async function upstream(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<{ baseURL: string; server: Server }> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('upstream did not bind');
  return { baseURL: `http://127.0.0.1:${address.port}/v1/`, server };
}

async function closeServer(server: Server | undefined) {
  if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

describe('custom provider routes acceptance contract', () => {
  let app: Started | undefined;
  let fake: Server | undefined;
  let home = '';
  let configPath = '';
  let globalConfig: Record<string, unknown>;
  let priorHome: string | undefined;

  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv('AGENT_LOCAL', 'true');
    priorHome = process.env.HOME;
    home = mkdtempSync(join(tmpdir(), 'rhythm-custom-provider-'));
    vi.stubEnv('HOME', home);
    configPath = join(home, '.config', 'opencode', 'opencode.json');
    mkdirSync(join(home, '.config', 'opencode'), { recursive: true });
    writeFileSync(configPath, JSON.stringify({ mcp: { retained: { type: 'local', command: ['true'] } }, plugin: ['keep-me'] }, null, 2));
    globalConfig = { mcp: { retained: { type: 'local', command: ['true'] } }, plugin: ['keep-me'] };
    engine.setAuth.mockReset().mockResolvedValue(true);
    engine.removeAuth.mockReset().mockResolvedValue(true);
    engine.getGlobalConfig.mockReset().mockImplementation(async () => structuredClone(globalConfig));
    engine.updateGlobalConfig.mockReset().mockImplementation(async (patch: Record<string, unknown>) => {
      globalConfig = { ...globalConfig, ...patch, provider: { ...(globalConfig.provider as Record<string, unknown> ?? {}), ...(patch.provider as Record<string, unknown> ?? {}) } };
      return true;
    });
    engine.reloadConfig.mockReset().mockResolvedValue(true);
    engine.providerSnapshot.mockReset().mockImplementation(async () => ({
      providers: [{ id: 'acceptance-provider', connected: true, digest: 'test', models: [
        { id: 'alpha-model', name: 'alpha-model' }, { id: 'zeta-model', name: 'zeta-model' },
      ] }], defaults: {},
    }));
    engine.listProviders.mockReset().mockResolvedValue([]);

    const { setDb } = await import('../database/db');
    const { runMigrations } = await import('../database/migrations');
    const db = new Database(':memory:');
    runMigrations(db);
    setDb(db);
    const { createApp } = await import('../app');
    app = await startTestServer(createApp());
  });

  afterEach(async () => {
    await app?.close();
    await closeServer(fake);
    app = undefined;
    fake = undefined;
    rmSync(home, { recursive: true, force: true });
    vi.unstubAllEnvs();
    if (priorHome === undefined) delete process.env.HOME;
    else process.env.HOME = priorHome;
  });

  const request = async (method: 'POST' | 'PUT', body: unknown) => fetch(`${app!.baseUrl}/opencode/providers${method === 'POST' ? '/test' : ''}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  it('accepts the exact closed schema, sends auth only when present, normalizes /models, and returns sorted unique models without reflecting the key', async () => {
    const seen: { url?: string; auth?: string; accept?: string } = {};
    const started = await upstream((req, res) => {
      seen.url = req.url;
      seen.auth = req.headers.authorization;
      seen.accept = req.headers.accept;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ data: [{ id: 'zeta-model' }, { id: 'alpha-model' }, { id: 'zeta-model' }] }));
    });
    fake = started.server;

    const response = await request('POST', valid(started.baseURL));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      providerId: 'acceptance-provider',
      modelCount: 2,
      models: [{ id: 'alpha-model', name: 'alpha-model' }, { id: 'zeta-model', name: 'zeta-model' }],
    });
    expect(seen).toEqual({ url: '/v1/models', auth: 'Bearer synthetic-custom-provider-key', accept: 'application/json' });
    expect(readFileSync(configPath, 'utf8')).not.toContain('acceptance-provider');
    expect(engine.setAuth).not.toHaveBeenCalled();
  });

  it.each([
    ['unknown field', { ...valid('https://models.example/v1'), extra: true }],
    ['uppercase provider id', { ...valid('https://models.example/v1'), providerId: 'Bad-ID' }],
    ['empty name', { ...valid('https://models.example/v1'), name: '  ' }],
    ['credentials', valid('https://user:pass@models.example/v1')],
    ['query', valid('https://models.example/v1?secret=1')],
    ['hash', valid('https://models.example/v1#fragment')],
    ['non-http', valid('file:///tmp/models')],
    ['public http hostname', valid('http://models.example/v1')],
    ['metadata IPv4', valid('http://169.254.169.254/latest')],
    ['metadata IPv6', valid('http://[fe80::1]/v1')],
    ['overlong URL', valid(`https://models.example/${'a'.repeat(4096)}`)],
  ])('rejects %s without probing, persisting, authenticating, or exposing input secrets', async (_label, body) => {
    const before = readFileSync(configPath, 'utf8');
    const response = await request('POST', body);
    expect(response.status).toBe(400);
    const text = await response.text();
    expect(text).not.toContain('synthetic-custom-provider-key');
    expect(readFileSync(configPath, 'utf8')).toBe(before);
    expect(engine.setAuth).not.toHaveBeenCalled();
  });

  it.each(['http://127.0.0.1:9/v1', 'http://10.1.2.3:9/v1', 'http://172.16.2.3:9/v1', 'http://192.168.1.2:9/v1', 'http://[::1]:9/v1'])('permits intentional local HTTP address policy: %s', (baseURL) => {
    expect(validateCustomProviderInput(valid(baseURL)).normalizedBaseURL).toBe(baseURL);
  });

  it('permits public HTTPS hostnames for DNS-pinned probing', () => {
    expect(validateCustomProviderInput(valid('https://models.example/v1')).normalizedBaseURL).toBe('https://models.example/v1');
  });

  it('omits Authorization without a key and caps sorted discovered models at 1000', async () => {
    let authorization: string | undefined;
    const started = await upstream((req, res) => {
      authorization = req.headers.authorization;
      res.end(JSON.stringify({ data: Array.from({ length: 1002 }, (_, index) => ({ id: `model-${String(index).padStart(4, '0')}` })).reverse() }));
    });
    fake = started.server;
    const input = valid(started.baseURL);
    delete input.apiKey;
    const response = await request('POST', input);
    const body = await response.json() as { modelCount: number; models: Array<{ id: string }> };
    expect(response.status).toBe(200);
    expect(authorization).toBeUndefined();
    expect(body.modelCount).toBe(1000);
    expect(body.models[0].id).toBe('model-0000');
    expect(body.models[999].id).toBe('model-0999');
  });

  it('times out a non-responsive provider after the bounded five-second window', async () => {
    const started = await upstream(() => undefined);
    fake = started.server;
    const response = await request('POST', valid(started.baseURL));
    expect(response.status).toBe(504);
    expect(await response.json()).toMatchObject({ error: 'provider_timeout' });
  }, 7_000);

  it.each([
    ['redirect', 302, { location: 'http://127.0.0.1:1/models' }, 'provider_redirect'],
    ['auth', 401, {}, 'provider_auth_failed'],
    ['upstream 500', 500, {}, 'provider_http_error'],
  ])('returns a stable sanitized %s taxonomy without upstream body/header reflection', async (_label, status, headers, code) => {
    const started = await upstream((_req, res) => {
      res.writeHead(status, { ...headers, 'x-secret': 'upstream-secret' });
      res.end('upstream-secret-body synthetic-custom-provider-key');
    });
    fake = started.server;
    const response = await request('POST', valid(started.baseURL));
    const text = await response.text();
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(JSON.parse(text).error).toBe(code);
    expect(text).not.toContain('upstream-secret');
    expect(text).not.toContain('synthetic-custom-provider-key');
  });

  it.each([
    ['invalid JSON', 'not-json'],
    ['invalid shape', JSON.stringify({ models: [{ id: 'wrong' }] })],
    ['invalid model id', JSON.stringify({ data: [{ id: 7 }] })],
  ])('rejects %s as provider_invalid_response', async (_label, body) => {
    const started = await upstream((_req, res) => { res.setHeader('content-type', 'application/json'); res.end(body); });
    fake = started.server;
    const response = await request('POST', valid(started.baseURL));
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: 'provider_invalid_response' });
  });

  it('rejects responses larger than 2 MiB without persisting', async () => {
    const started = await upstream((_req, res) => { res.end(JSON.stringify({ data: [{ id: 'x'.repeat(2 * 1024 * 1024) }] })); });
    fake = started.server;
    const before = readFileSync(configPath, 'utf8');
    const response = await request('POST', valid(started.baseURL));
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: 'provider_invalid_response' });
    expect(readFileSync(configPath, 'utf8')).toBe(before);
  });

  it('PUT re-tests, authenticates, uses native global config mutation, preserves unknown config, and verifies observability without ordinary reload', async () => {
    const started = await upstream((_req, res) => { res.end(JSON.stringify({ data: [{ id: 'zeta-model' }, { id: 'alpha-model' }] })); });
    fake = started.server;
    const response = await request('PUT', valid(started.baseURL));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, providerId: 'acceptance-provider', modelCount: 2 });
    expect((globalConfig.mcp as { retained: { command: string[] } }).retained.command).toEqual(['true']);
    expect(globalConfig.plugin).toEqual(['keep-me']);
    expect((globalConfig.provider as Record<string, unknown>)['acceptance-provider']).toEqual({
      npm: '@ai-sdk/openai-compatible',
      name: 'Acceptance Provider',
      options: { baseURL: started.baseURL.replace(/\/$/, '') },
      models: { 'alpha-model': { name: 'alpha-model' }, 'zeta-model': { name: 'zeta-model' } },
    });
    expect(JSON.stringify(globalConfig)).not.toContain('synthetic-custom-provider-key');
    expect(engine.setAuth).toHaveBeenCalledWith('acceptance-provider', 'synthetic-custom-provider-key');
    expect(engine.updateGlobalConfig).toHaveBeenCalledWith({ provider: expect.objectContaining({ 'acceptance-provider': expect.any(Object) }) });
    expect(engine.reloadConfig).not.toHaveBeenCalled();
    expect(engine.removeAuth).not.toHaveBeenCalled();
    expect(engine.providerSnapshot).toHaveBeenCalled();
  });

  it('removes newly-created auth and leaves config unchanged when global config mutation fails', async () => {
    const started = await upstream((_req, res) => { res.end(JSON.stringify({ data: [{ id: 'alpha-model' }] })); });
    fake = started.server;
    const before = structuredClone(globalConfig);
    engine.updateGlobalConfig.mockResolvedValueOnce(false);
    const response = await request('PUT', valid(started.baseURL));
    expect(response.status).toBe(502);
    expect(globalConfig).toEqual(before);
    expect(engine.removeAuth).toHaveBeenCalledWith('acceptance-provider');
    expect(engine.reloadConfig).not.toHaveBeenCalled();
  });

  it('does not mutate config or remove auth when auth.set fails', async () => {
    const started = await upstream((_req, res) => { res.end(JSON.stringify({ data: [{ id: 'alpha-model' }] })); });
    fake = started.server;
    const before = structuredClone(globalConfig);
    engine.setAuth.mockResolvedValueOnce(false);
    const response = await request('PUT', valid(started.baseURL));
    expect(response.status).toBe(502);
    expect(globalConfig).toEqual(before);
    expect(engine.updateGlobalConfig).not.toHaveBeenCalled();
    expect(engine.removeAuth).not.toHaveBeenCalled();
  });

  it('returns 202 pending after committed global config when the provider catalog is still refreshing', async () => {
    const started = await upstream((_req, res) => { res.end(JSON.stringify({ data: [{ id: 'alpha-model' }] })); });
    fake = started.server;
    engine.providerSnapshot.mockResolvedValue({ providers: [], defaults: {} });
    const response = await request('PUT', valid(started.baseURL));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ ok: true, pending: true, providerId: 'acceptance-provider', modelCount: 1 });
    expect((globalConfig.provider as Record<string, unknown>)['acceptance-provider']).toBeDefined();
    expect(engine.removeAuth).not.toHaveBeenCalled();
  });

  it('is absent from hosted/cloud deployment role, preventing a remote arbitrary-fetch/config-write surface', async () => {
    await app?.close();
    app = undefined;
    vi.resetModules();
    vi.stubEnv('RHYTHM_ROLE', 'cloud');
    vi.stubEnv('AGENT_LOCAL', '');
    const { createApp } = await import('../app');
    app = await startTestServer(createApp());
    const response = await request('POST', valid('https://models.example/v1'));
    expect(response.status).toBe(404);
  });
});
