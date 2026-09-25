import { createServer } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createApp } from '../app';
import { runMigrations } from '../database/migrations';
import { getDb, setDb } from '../database/db';
import { startTestServer } from './helpers/real_server';
import { UsersRepository } from '../repositories/users_repository';
import { SessionsRepository } from '../repositories/sessions_repository';
import { resetProbeCache } from '../services/provider_catalog_policy';
import { listAgentModelCatalog } from '../routes/agents_models_routes';
import { resolveModelForAgent } from '../services/agent_model_resolver';

const { snapshot, config, authedProviders } = vi.hoisted(() => ({
  snapshot: vi.fn(),
  config: vi.fn(() => JSON.stringify({ provider: {} })),
  authedProviders: vi.fn().mockResolvedValue([]),
}));
vi.mock('node:fs', async (original) => {
  const fs = await original<typeof import('node:fs')>();
  return { ...fs, readFileSync: (path: string, ...args: unknown[]) =>
    path.endsWith('/.config/opencode/opencode.json') ? config() : (fs.readFileSync as (...args: unknown[]) => unknown)(path, ...args) };
});
vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    providerSnapshot: snapshot,
    listAuthedProviders: authedProviders,
    isReady: true,
    statusMessage: 'ready',
  },
  opencodeSessionMap: new Map(),
}));
vi.mock('../services/opencode_stream_bridge', () => ({ streamBridge: {
  streamSession: vi.fn().mockResolvedValue(undefined), stopStream: vi.fn(), dispose: vi.fn(),
} }));

const capable = { input: { text: true }, output: { text: true }, toolcall: true };
type Model = {
  id: string;
  name?: string;
  apiId?: string;
  capabilities?: typeof capable;
  status?: string;
  contextLimit?: number;
};
function provider(id: string, models: Model[], connected = true, endpoint?: string, source?: string) {
  return {
    id,
    models,
    connected,
    digest: `${id}-digest`,
    ...(endpoint ? { endpoint } : {}),
    ...(source ? { source } : {}),
  };
}
function eligible(id: string, extra: Partial<Model> = {}): Model {
  return { id, capabilities: capable, ...extra };
}

describe('engine-authoritative model catalog routes', () => {
  let baseUrl: string;
  let close: () => Promise<void>;
  let headers: Record<string, string>;

  beforeEach(async () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);
    const user = new UsersRepository().create({ name: 'Catalog', email: 'catalog@example.com' });
    const session = await new SessionsRepository().createAsync(user.id);
    headers = { Authorization: `Bearer ${session.token}` };
    snapshot.mockResolvedValue({ providers: [
      provider('anthropic', [eligible('claude-sonnet-4-6')]),
      provider('openai', [eligible('gpt-5.6-sol')], false),
    ] });
    config.mockReturnValue(JSON.stringify({ provider: {} }));
    authedProviders.mockResolvedValue([]);
    resetProbeCache();
    ({ baseUrl, close } = await startTestServer(createApp()));
  });

  afterEach(async () => {
    await close();
    vi.clearAllMocks();
    resetProbeCache();
  });

  async function rows(path = '/agents/models/catalog/full') {
    const response = await fetch(`${baseUrl}${path}`, { headers, signal: AbortSignal.timeout(4000) });
    expect(response.status).toBe(200);
    return response.json() as Promise<Array<Record<string, unknown>>>;
  }

  it('issue-1572-c3: empty real snapshot returns no stale fallback routes', async () => {
    snapshot.mockResolvedValue({ providers: [] });
    expect((await rows()).filter((row) => row.modelId !== '')).toEqual([]);
    expect(await rows('/agents/models?agentId=codex')).toEqual([]);
  });

  it('issue-1572-c7: direct cloud providers expose only explicitly approved current families', async () => {
    snapshot.mockResolvedValue({ providers: [
      provider('openai', [
        eligible('gpt-5.6-luna'), eligible('gpt-5.6-terra'), eligible('gpt-5.6-sol'),
        eligible('gpt-arbitrary-capable'),
      ]),
      provider('anthropic', [
        eligible('claude-opus-4-7'), eligible('claude-opus-4-7-1m'),
        eligible('claude-sonnet-4-6'), eligible('claude-haiku-4-5'),
        eligible('claude-older-capable'),
      ]),
      provider('google', [
        eligible('gemini-2.5-pro'), eligible('gemini-2.5-flash'),
        eligible('gemini-3.1-pro-preview'), eligible('gemini-3-flash-preview'),
        eligible('gemini-arbitrary-capable'),
      ]),
    ] });

    const result = await rows();
    const ids = (providerId: string) => result.filter((row) => row.provider === providerId).map((row) => row.modelId);
    expect(ids('openai')).toEqual(['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol']);
    expect(ids('anthropic')).toEqual([
      'claude-opus-4-7', 'claude-opus-4-7-1m', 'claude-sonnet-4-6', 'claude-haiku-4-5',
    ]);
    expect(ids('google')).toEqual([
      'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-3.1-pro-preview', 'gemini-3-flash-preview',
    ]);
  });

  it('1572:1572-S1:1 connected curated direct models remain selectable while entitlement is unverified', async () => {
    snapshot.mockResolvedValue({ providers: [provider('openai', [
      eligible('gpt-5.6-sol'), eligible('gpt-5.6-terra'), eligible('gpt-4.1'),
    ])] });
    expect(await rows()).toContainEqual(expect.objectContaining({
      provider: 'openai', modelId: 'gpt-5.6-sol', authorized: true,
      available: 'unknown', availabilityReason: 'account_entitlement_unverified',
    }));
    expect(await rows('/agents/models/catalog')).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: 'openai', modelId: 'gpt-5.6-sol' }),
      expect.objectContaining({ provider: 'openai', modelId: 'gpt-5.6-terra' }),
    ]));
    expect(await rows('/agents/models?agentId=codex')).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerId: 'openai', modelId: 'gpt-5.6-sol' }),
      expect.objectContaining({ providerId: 'openai', modelId: 'gpt-5.6-terra' }),
    ]));
    expect((await rows()).some((row) => row.modelId === 'gpt-4.1')).toBe(false);
  });

  it('issue-1572-c4: configured built-in Ollama is selectable while undeclared models stay hidden', async () => {
    snapshot.mockResolvedValue({ providers: [provider('ollama', [eligible('local'), eligible('undeclared')])] });
    config.mockReturnValue(JSON.stringify({ provider: { ollama: { models: { local: {} } } } }));
    const result = await rows();
    expect(result).toContainEqual(expect.objectContaining({
      provider: 'ollama', modelId: 'local', authorized: true, available: true,
    }));
    expect(result.some((row) => row.modelId === 'undeclared')).toBe(false);
  });

  it('issue-1572-c4/c14: configured custom alias maps inventory apiId and remains opencode-selectable', async () => {
    let authorization: string | string[] | undefined;
    const inventory = createServer((request, response) => {
      authorization = request.headers.authorization;
      expect(request.url).toBe('/v1/models');
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ data: [{ id: 'qwen:latest' }, { id: 'unconfigured' }] }));
    });
    await new Promise<void>((resolve) => inventory.listen(0, '127.0.0.1', resolve));
    try {
      const address = inventory.address();
      if (!address || typeof address === 'string') throw new Error('expected inventory port');
      const origin = `http://127.0.0.1:${address.port}`;
      snapshot.mockResolvedValue({ providers: [provider('mesh', [
        eligible('ollama-planner', { apiId: 'qwen:latest', contextLimit: 131072 }),
        eligible('stale'),
      ], false, origin)] });
      config.mockReturnValue(JSON.stringify({ provider: { mesh: {
        options: { baseURL: `${origin}/v1` }, models: { 'ollama-planner': {} },
      } } }));

      const result = await rows();
      expect(result).toContainEqual(expect.objectContaining({
        agent: 'opencode', provider: 'mesh', modelId: 'ollama-planner', apiId: 'qwen:latest',
        contextLimit: 131072, authorized: true, available: true,
      }));
      expect(result.some((row) => row.modelId === 'stale')).toBe(false);
      expect(await rows('/agents/models?agentId=opencode')).toContainEqual(expect.objectContaining({
        providerId: 'mesh', modelId: 'ollama-planner', routeKind: 'direct',
      }));
      expect(await rows('/agents/models?agentId=claude-code')).toEqual([]);
      expect(authorization).toBeUndefined();
    } finally {
      await new Promise<void>((resolve) => inventory.close(() => resolve()));
    }
  });

  it('1572:1572-S1:18 a models override without baseURL keeps the engine-managed catalog selectable', async () => {
    snapshot.mockResolvedValue({ providers: [provider('mesh', [eligible('declared'), eligible('stale')])] });
    config.mockReturnValue(JSON.stringify({ provider: { mesh: { models: { declared: {} } } } }));
    const result = await rows();
    expect(result).toContainEqual(expect.objectContaining({
      provider: 'mesh', modelId: 'declared', authorized: true, available: 'unknown',
      availabilityReason: 'account_entitlement_unverified',
    }));
    expect(result).toContainEqual(expect.objectContaining({
      provider: 'mesh', modelId: 'stale', authorized: true, available: 'unknown',
    }));
  });

  it('issue-1572-c8: per-agent picker shares engine visibility and never resurrects a removed route', async () => {
    getDb().prepare(`INSERT INTO agent_model_visibility (provider, model_id, visible) VALUES ('openrouter', 'other/chat', 1)`).run();
    snapshot.mockResolvedValue({ providers: [provider('openrouter', [eligible('other/chat')])] });
    expect(await rows('/agents/models?agentId=claude-code')).toContainEqual(expect.objectContaining({ modelId: 'other/chat' }));
    snapshot.mockResolvedValue({ providers: [provider('openrouter', [eligible('different/chat')])] });
    expect((await rows('/agents/models?agentId=claude-code')).some((row) => row.modelId === 'other/chat')).toBe(false);
  });

  it('issue-1572-c9: failed inventory yields no guessed model and bounded response', async () => {
    snapshot.mockRejectedValue(new Error('engine_unverified'));
    expect(await rows()).toEqual([]);
  });

  it('issue-1572-c16: full retains unavailable rows while compatibility routes require available=true', async () => {
    getDb().prepare(`INSERT INTO agent_model_visibility (provider, model_id, visible) VALUES ('openrouter', 'other/chat', 1)`).run();
    snapshot.mockResolvedValue({ providers: [
      provider('openai', [{ id: 'gpt-5.6-sol', capabilities: { ...capable, toolcall: false } }]),
      provider('openrouter', [eligible('other/chat')]),
    ] });
    const full = await rows();
    expect(full).toContainEqual(expect.objectContaining({ modelId: 'gpt-5.6-sol', authorized: true, available: false }));
    const compatible = await rows('/agents/models/catalog');
    expect(compatible.map((row) => row.modelId)).not.toContain('gpt-5.6-sol');
    expect(compatible.map((row) => row.modelId)).toContain('other/chat');
    expect(await rows('/agents/models?agentId=claude-code')).toContainEqual(expect.objectContaining({
      modelId: 'other/chat', routeKind: 'aggregator',
    }));
  });

  it.each([
    { toolcall: true, keepsAggregator: false },
    { toolcall: false, keepsAggregator: true },
  ])('review:review-findings.md:34 suppresses OpenRouter by direct authorization unless the direct family is unavailable: %o', async ({ toolcall, keepsAggregator }) => {
    getDb().prepare(`INSERT INTO agent_model_visibility (provider, model_id, visible) VALUES ('openrouter', 'anthropic/claude-opus-4.7', 1)`).run();
    snapshot.mockResolvedValue({ providers: [
      provider('anthropic', [{ ...eligible('claude-opus-4-7'), capabilities: { ...capable, toolcall } }]),
      provider('openrouter', [eligible('anthropic/claude-opus-4.7')]),
    ] });
    const result = await rows();
    expect(result).toContainEqual(expect.objectContaining({ provider: 'anthropic', modelId: 'claude-opus-4-7', available: toolcall ? 'unknown' : false }));
    for (const catalog of [result, await rows('/agents/models/catalog')]) {
      expect(catalog.some((row) =>
        row.provider === 'openrouter' && row.modelId === 'anthropic/claude-opus-4.7'))
        .toBe(keepsAggregator);
    }
    expect((await rows('/agents/models?agentId=claude-code')).some((row) =>
      row.modelId === 'anthropic/claude-opus-4.7' && row.routeKind === 'aggregator'))
      .toBe(keepsAggregator);
  });

  it('issue-1572-c16: a hidden direct row cannot suppress a visible aggregator alternative', async () => {
    getDb().prepare(`INSERT INTO agent_model_visibility (provider, model_id, visible) VALUES
      ('anthropic', 'claude-opus-4-7', 0),
      ('openrouter', 'anthropic/claude-opus-4.7', 1)`).run();
    snapshot.mockResolvedValue({ providers: [
      provider('anthropic', [eligible('claude-opus-4-7')]),
      provider('openrouter', [eligible('anthropic/claude-opus-4.7')]),
    ] });
    const result = await rows();
    expect(result.some((row) => row.provider === 'anthropic')).toBe(false);
    expect(result).toContainEqual(expect.objectContaining({
      provider: 'openrouter', modelId: 'anthropic/claude-opus-4.7', available: true,
    }));
  });

  it('restores authorization partition and connectUrl coverage on the real route', async () => {
    snapshot.mockResolvedValue({ providers: [
      provider('anthropic', [eligible('claude-sonnet-4-6')]),
      provider('openai', [eligible('gpt-5.6-sol')], false),
    ] });
    const result = await rows();
    expect(result).toContainEqual(expect.objectContaining({
      provider: 'anthropic', authorized: true,
      connectUrl: '/opencode/auth/anthropic/authorize',
    }));
    expect(result).toContainEqual(expect.objectContaining({
      provider: 'openai', authorized: false,
      connectUrl: '/opencode/auth/openai/authorize',
    }));
  });

  it('restores contextLimit and single-row duplicate coverage', async () => {
    snapshot.mockResolvedValue({ providers: [provider('anthropic', [
      eligible('claude-sonnet-4-6', { contextLimit: 200000 }),
    ])] });
    const result = await rows();
    const matches = result.filter((row) => row.provider === 'anthropic' && row.modelId === 'claude-sonnet-4-6');
    expect(matches).toHaveLength(1);
    expect(matches[0]).toEqual(expect.objectContaining({ contextLimit: 200000 }));
  });

  it('1572:1572-S1:2 probes localhost custom inventory without forwarding authorization', async () => {
    let authorization: string | string[] | undefined;
    const inventory = createServer((request, response) => {
      authorization = request.headers.authorization;
      expect(request.url).toBe('/v1/models');
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ data: [{ id: 'declared' }] }));
    });
    await new Promise<void>((resolve) => inventory.listen(0, 'localhost', resolve));
    try {
      const address = inventory.address();
      if (!address || typeof address === 'string') throw new Error('expected inventory port');
      const baseURL = `http://localhost:${address.port}/v1`;
      snapshot.mockResolvedValue({ providers: [provider('local-custom', [eligible('declared')], false, `http://localhost:${address.port}`)] });
      config.mockReturnValue(JSON.stringify({ provider: {
        'local-custom': { options: { baseURL }, models: { declared: {} } },
      } }));

      expect(await rows('/agents/models/catalog')).toContainEqual(expect.objectContaining({
        provider: 'local-custom', modelId: 'declared', authorized: true, available: true,
      }));
      expect(authorization).toBeUndefined();
    } finally {
      await new Promise<void>((resolve) => inventory.close(() => resolve()));
    }
  });

  it('1572:1572-S1:3 keeps a configured public custom row selectable with unknown availability and makes no provider request', async () => {
    snapshot.mockResolvedValue({ providers: [provider('public-custom', [eligible('declared')], false, 'https://models.example.test')] });
    config.mockReturnValue(JSON.stringify({ provider: {
      'public-custom': { options: { baseURL: 'https://models.example.test/v1' }, models: { declared: {} } },
    } }));
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('provider fetch forbidden'));
    try {
      const result = await listAgentModelCatalog();
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(result).toContainEqual(expect.objectContaining({
        provider: 'public-custom', modelId: 'declared', authorized: true,
        available: 'unknown', availabilityReason: 'account_entitlement_unverified',
      }));
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it.each(['//evil.example/v1', '/\\\\evil.example/v1'])(
    '1572:1572-S1:4 rejects custom base path escape %s without any outbound request',
    async (pathEscape) => {
      snapshot.mockResolvedValue({ providers: [provider('escaped-custom', [eligible('declared')], false, 'http://127.0.0.1:7488')] });
      config.mockReturnValue(JSON.stringify({ provider: {
        'escaped-custom': {
          options: { baseURL: `http://127.0.0.1:7488${pathEscape}` },
          models: { declared: {} },
        },
      } }));
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('must not fetch'));
      try {
        const result = await listAgentModelCatalog();
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(result).toContainEqual(expect.objectContaining({
          provider: 'escaped-custom', modelId: 'declared', available: false,
        }));
      } finally {
        fetchSpy.mockRestore();
      }
    },
  );

  it('1572:1572-S1:5 preserves #609 default visibility for confirmed fallback rows and explicit visible=0', async () => {
    snapshot.mockResolvedValue({ providers: [provider('openrouter', [eligible('anthropic/claude-sonnet-4.6')])] });
    expect(await rows('/agents/models/catalog')).toContainEqual(expect.objectContaining({
      provider: 'openrouter', modelId: 'anthropic/claude-sonnet-4.6', available: true,
    }));

    getDb().prepare(`INSERT INTO agent_model_visibility (provider, model_id, visible)
      VALUES ('openrouter', 'anthropic/claude-sonnet-4.6', 0)`).run();
    expect((await rows('/agents/models/catalog')).some((row) =>
      row.provider === 'openrouter' && row.modelId === 'anthropic/claude-sonnet-4.6')).toBe(false);
  });

  it('1572:1572-S1:6 suppresses OpenRouter vendor rows per agent when that direct provider is authorized', async () => {
    getDb().prepare(`INSERT INTO agent_model_visibility (provider, model_id, visible)
      VALUES ('openrouter', 'anthropic/claude-sonnet-4.6', 1)`).run();
    snapshot.mockResolvedValue({ providers: [
      provider('anthropic', [eligible('claude-sonnet-4-6')]),
      provider('openrouter', [eligible('anthropic/claude-sonnet-4.6')]),
    ] });
    const catalog = await rows('/agents/models/catalog');
    expect(catalog).not.toContainEqual(expect.objectContaining({
      agent: 'claude-code', provider: 'openrouter', modelId: 'anthropic/claude-sonnet-4.6',
    }));
    expect(catalog).toContainEqual(expect.objectContaining({
      agent: 'opencode', provider: 'openrouter', modelId: 'anthropic/claude-sonnet-4.6',
    }));

    snapshot.mockResolvedValue({ providers: [
      provider('ollama', [eligible('local')]),
      provider('openrouter', [eligible('ollama/local')]),
    ] });
    config.mockReturnValue(JSON.stringify({ provider: { ollama: { models: { local: {} } } } }));
    expect((await rows('/agents/models/catalog')).some((row) =>
      row.provider === 'openrouter' && row.modelId === 'ollama/local')).toBe(false);
  });

  it.each([
    {
      name: 'config metadata only',
      source: 'config',
      providerConfig: { models: { 'gpt-5.6-sol': {} } },
      authorized: false,
    },
    {
      name: 'options apiKey',
      source: 'config',
      providerConfig: { options: { apiKey: 'synthetic-key' } },
      authorized: true,
    },
    {
      name: 'environment credential',
      source: 'env',
      providerConfig: { models: { 'gpt-5.6-sol': {} } },
      authorized: true,
    },
  ])('review:review-findings.md:84 authorizes built-ins only from credential evidence: $name', async ({ source, providerConfig, authorized }) => {
    snapshot.mockResolvedValue({ providers: [
      provider('openai', [eligible('gpt-5.6-sol')], false, undefined, source),
    ] });
    config.mockReturnValue(JSON.stringify({ provider: { openai: providerConfig } }));

    const result = await rows('/agents/models/catalog/full');
    expect(result).toContainEqual(expect.objectContaining({
      provider: 'openai', modelId: 'gpt-5.6-sol', authorized,
      availabilityReason: authorized ? 'account_entitlement_unverified' : 'not_connected',
    }));
    if (!authorized) {
      expect(result).toContainEqual(expect.objectContaining({
        provider: 'openai', modelId: '', authorized: false,
        connectUrl: '/opencode/auth/openai/authorize',
      }));
      expect(await rows('/agents/models?agentId=codex')).toEqual([]);
    }
  });

  it('review:review-findings.md:115 keeps built-in providers on direct policy when baseURL is overridden', async () => {
    snapshot.mockResolvedValue({ providers: [provider(
      'anthropic',
      [eligible('claude-opus-5-5'), eligible('claude-sonnet-5')],
      true,
      'https://proxy.example.test',
      'api',
    )] });
    config.mockReturnValue(JSON.stringify({ provider: { anthropic: {
      options: { baseURL: 'https://proxy.example.test/v1' },
    } } }));

    const result = await rows('/agents/models/catalog');
    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({ agent: 'claude-code', provider: 'anthropic', modelId: 'claude-opus-5-5' }),
      expect.objectContaining({ agent: 'claude-code', provider: 'anthropic', modelId: 'claude-sonnet-5' }),
    ]));
  });

  it.each([
    ['query-string', 'http://127.0.0.1:7488/v1?api-version=preview', 'http://127.0.0.1:7488'],
    ['environment substitution', '{env:LAN_LLM_URL}/v1', 'http://192.168.50.10:8000'],
  ])('review:review-findings.md:2 keeps unprobeable %s custom endpoints selectable as unknown', async (_name, baseURL, endpoint) => {
    snapshot.mockResolvedValue({ providers: [provider('mesh', [eligible('declared')], false, endpoint)] });
    config.mockReturnValue(JSON.stringify({ provider: { mesh: {
      options: { baseURL }, models: { declared: {} },
    } } }));
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('must not probe'));
    try {
      expect(await listAgentModelCatalog()).toContainEqual(expect.objectContaining({
        agent: 'opencode', provider: 'mesh', modelId: 'declared', authorized: true,
        available: 'unknown', availabilityReason: 'account_entitlement_unverified',
      }));
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('review:review-findings.md:121 keeps a local custom model selectable when inventory authentication returns 401', async () => {
    const inventory = createServer((_request, response) => {
      response.statusCode = 401;
      response.end();
    });
    await new Promise<void>((resolve) => inventory.listen(0, '127.0.0.1', resolve));
    try {
      const address = inventory.address();
      if (!address || typeof address === 'string') throw new Error('expected inventory port');
      const origin = `http://127.0.0.1:${address.port}`;
      snapshot.mockResolvedValue({ providers: [provider('mesh', [eligible('declared')], false, origin)] });
      config.mockReturnValue(JSON.stringify({ provider: { mesh: {
        options: { baseURL: `${origin}/v1` }, models: { declared: {} },
      } } }));
      expect(await rows('/agents/models/catalog')).toContainEqual(expect.objectContaining({
        provider: 'mesh', modelId: 'declared', available: 'unknown',
        availabilityReason: 'account_entitlement_unverified',
      }));
    } finally {
      await new Promise<void>((resolve) => inventory.close(() => resolve()));
    }
  });

  it('1572:1572-S1:7 keeps options-only and engine-managed providers authorized without shrinking their catalog', async () => {
    snapshot.mockResolvedValue({ providers: [
      provider('deepseek', [eligible('deepseek-chat'), eligible('deepseek-reasoner')], false, undefined, 'config'),
      provider('opencode', [eligible('deepseek-v4-flash-free')], true, undefined, 'custom'),
      provider('xai', [eligible('grok-chat')], false, undefined, 'env'),
    ] });
    config.mockReturnValue(JSON.stringify({ provider: {
      deepseek: { options: { apiKey: 'synthetic-key' }, models: { 'deepseek-chat': { limit: { context: 1000 } } } },
    } }));

    const result = await rows('/agents/models/catalog');
    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({ agent: 'opencode', provider: 'deepseek', modelId: 'deepseek-chat', authorized: true }),
      expect.objectContaining({ agent: 'opencode', provider: 'deepseek', modelId: 'deepseek-reasoner', authorized: true }),
      expect.objectContaining({ agent: 'opencode', provider: 'opencode', modelId: 'deepseek-v4-flash-free', authorized: true }),
      expect.objectContaining({ agent: 'opencode', provider: 'xai', modelId: 'grok-chat', authorized: true }),
    ]));
  });

  it('1572:1572-S1:8 emits provider-level Connect rows without stale fallback model IDs', async () => {
    snapshot.mockResolvedValue({ providers: [] });
    const result = await rows('/agents/models/catalog/full');
    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: 'anthropic', modelId: '', authorized: false }),
      expect.objectContaining({ provider: 'openai', modelId: '', authorized: false }),
      expect.objectContaining({ provider: 'google', modelId: '', authorized: false }),
    ]));
    expect(result.every((row) => row.modelId === '')).toBe(true);
    expect(await rows('/agents/models?agentId=codex')).toEqual([]);
  });

  it.each([
    ['claude-code', 'anthropic', ['claude-opus-4-7', 'claude-opus-5-5', 'claude-sonnet-5']],
    ['claude-code', 'github-copilot', ['claude-opus-4.7', 'claude-opus-5.5', 'claude-sonnet-5']],
    ['codex', 'openai', ['gpt-5.6-sol', 'gpt-5.6-terra']],
    ['gemini-cli', 'google', ['gemini-2.5-pro', 'gemini-3-flash-preview']],
    ['opencode', 'openrouter', ['anthropic/claude-sonnet-4.6']],
    ['opencode', 'ollama', ['qwen3.6-work']],
  ])('1572:1572-S1:9 resolves %s through %s to a catalog-visible selectable row', async (agent, providerId, modelIds) => {
    snapshot.mockResolvedValue({ providers: [provider(
      providerId,
      modelIds.map((id) => eligible(id)),
    )] });
    config.mockReturnValue(JSON.stringify({ provider: providerId === 'ollama'
      ? { ollama: { models: { 'qwen3.6-work': {} } } }
      : {} }));
    authedProviders.mockResolvedValue([providerId]);

    const resolved = await resolveModelForAgent(agent);
    expect(resolved).toBeDefined();
    const catalog = await listAgentModelCatalog();
    expect(catalog).toContainEqual(expect.objectContaining({
      agent,
      provider: resolved!.providerID,
      modelId: resolved!.modelID,
      authorized: true,
      visible: true,
    }));
    expect(await rows(`/agents/models?agentId=${agent}`)).toContainEqual(expect.objectContaining({
      providerId: resolved!.providerID,
      modelId: resolved!.modelID,
    }));
  });
});
