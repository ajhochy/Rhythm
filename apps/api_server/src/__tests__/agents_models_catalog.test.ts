/**
 * Issue #602 — GET /agents/models/catalog
 *
 * Tests the cross-agent catalog endpoint: shape, authorized/unauthorized
 * partitioning, and visibility-map filtering for OpenRouter rows.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { createApp } from '../app';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { startTestServer } from './helpers/real_server';
import { UsersRepository } from '../repositories/users_repository';
import { SessionsRepository } from '../repositories/sessions_repository';

// The runtime config is the filesystem boundary for custom-provider usability.
const { mockReadFileSync } = vi.hoisted(() => ({
  mockReadFileSync: vi.fn(() => JSON.stringify({ provider: { 'glm-mesh': {} } })),
}));

vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  readFileSync: mockReadFileSync,
}));

// Provide a controllable authed-providers list.
const mockAuthedProviders: string[] = [];

vi.mock('../services/opencode_engine', () => {
  const mockClient = {
    isReady: true,
    listModels: vi.fn().mockImplementation((providerId: string) => {
      const byProvider: Record<string, Array<{ id: string; name?: string; contextLimit?: number }>> = {
        anthropic: [
          { id: 'claude-opus-4-7', contextLimit: 200000 },
          { id: 'claude-opus-4-5', contextLimit: 200000 },
          { id: 'claude-sonnet-4-6', contextLimit: 200000 },
          { id: 'claude-haiku-4-5', contextLimit: 200000 },
        ],
        openai: [
          { id: 'gpt-5.3-codex' },
          { id: 'gpt-5.4' },
          { id: 'gpt-5.4-mini' },
        ],
        openrouter: [
          { id: 'anthropic/claude-opus-4.7' },
          { id: 'anthropic/claude-sonnet-4.6' },
          { id: 'anthropic/claude-haiku-4.5' },
          { id: 'openai/gpt-5.3-codex' },
          { id: 'openai/gpt-5.4' },
          { id: 'openai/gpt-5.4-mini' },
        ],
      };
      return Promise.resolve(byProvider[providerId] ?? []);
    }),
    listAuthedProviders: vi.fn().mockImplementation(() =>
      Promise.resolve(mockAuthedProviders),
    ),
    // #1143 — the full live provider catalog. Default: only the static
    // providers (no custom ones) so existing tests are unaffected; the
    // custom-provider test overrides this to add e.g. glm-mesh.
    listProviders: vi.fn().mockResolvedValue([
      { id: 'anthropic', models: [] },
      { id: 'openai', models: [] },
      { id: 'openrouter', models: [] },
    ]),
    statusMessage: 'ready',
    createSession: vi.fn().mockResolvedValue({ id: 'sdk-1' }),
    setAuth: vi.fn().mockResolvedValue(true),
    promptAsync: vi.fn().mockResolvedValue(true),
    subscribeToEvents: vi.fn().mockResolvedValue(null),
  };
  return {
    opencodeClient: mockClient,
    opencodeSessionMap: new Map<string, string>(),
  };
});

vi.mock('../services/opencode_stream_bridge', () => ({
  streamBridge: {
    streamSession: vi.fn().mockResolvedValue(undefined),
    stopStream: vi.fn(),
    dispose: vi.fn(),
  },
}));

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

describe('GET /agents/models/catalog', () => {
  let baseUrl: string;
  let authHeaders: Record<string, string>;
  let closeServer: () => Promise<void>;

  beforeEach(async () => {
    // Reset authed providers before each test.
    mockAuthedProviders.length = 0;

    setDb(makeDb());

    const user = new UsersRepository().create({ name: 'Test', email: 'test@example.com' });
    const session = await new SessionsRepository().createAsync(user.id);
    authHeaders = { Authorization: `Bearer ${session.token}` };

    ({ baseUrl, close: closeServer } = await startTestServer(createApp()));
  });

  it('returns a non-empty array with the expected shape', async () => {
    const res = await fetch(`${baseUrl}/agents/models/catalog`, {
      headers: authHeaders,
    });
    expect(res.status).toBe(200);
    const rows = await res.json() as unknown[];
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);

    const first = rows[0] as Record<string, unknown>;
    expect(first).toHaveProperty('agent');
    expect(first).toHaveProperty('provider');
    expect(first).toHaveProperty('modelId');
    expect(first).toHaveProperty('route');
    expect(first).toHaveProperty('authorized');
    expect(first).toHaveProperty('authProvider');
  });

  it('marks rows authorized when provider is in the authed set', async () => {
    mockAuthedProviders.push('anthropic');

    const res = await fetch(`${baseUrl}/agents/models/catalog`, {
      headers: authHeaders,
    });
    const rows = await res.json() as Array<Record<string, unknown>>;

    const anthropicRows = rows.filter((r) => r.provider === 'anthropic');
    expect(anthropicRows.length).toBeGreaterThan(0);
    for (const row of anthropicRows) {
      expect(row.authorized).toBe(true);
    }

    const openaiRows = rows.filter((r) => r.provider === 'openai');
    expect(openaiRows.length).toBeGreaterThan(0);
    for (const row of openaiRows) {
      expect(row.authorized).toBe(false);
    }
  });

  it('marks all rows unauthorized when no providers are authed', async () => {
    // mockAuthedProviders is empty (reset in beforeEach)
    const res = await fetch(`${baseUrl}/agents/models/catalog`, {
      headers: authHeaders,
    });
    const rows = await res.json() as Array<Record<string, unknown>>;
    for (const row of rows) {
      expect(row.authorized).toBe(false);
    }
  });

  it('includes connectUrl for unauthorized rows', async () => {
    const res = await fetch(`${baseUrl}/agents/models/catalog`, {
      headers: authHeaders,
    });
    const rows = await res.json() as Array<Record<string, unknown>>;
    const withConnectUrl = rows.filter((r) => r.connectUrl !== undefined);
    expect(withConnectUrl.length).toBeGreaterThan(0);
  });

  it('separates direct and aggregator routes', async () => {
    const res = await fetch(`${baseUrl}/agents/models/catalog`, {
      headers: authHeaders,
    });
    const rows = await res.json() as Array<Record<string, unknown>>;
    const direct = rows.filter((r) => r.route === 'direct');
    const aggregator = rows.filter((r) => r.route === 'aggregator');
    expect(direct.length).toBeGreaterThan(0);
    expect(aggregator.length).toBeGreaterThan(0);
  });

  it('filters out openrouter rows with visible=0 in the visibility table', async () => {
    const { getDb } = await import('../database/db');
    const db = getDb();
    // Seed one visibility=0 row for a known openrouter model.
    db.prepare(
      `INSERT OR REPLACE INTO agent_model_visibility (provider, model_id, visible) VALUES ('openrouter', 'anthropic/claude-opus-4.7', 0)`,
    ).run();

    const res = await fetch(`${baseUrl}/agents/models/catalog`, {
      headers: authHeaders,
    });
    const rows = await res.json() as Array<Record<string, unknown>>;
    const hidden = rows.find(
      (r) => r.provider === 'openrouter' && r.modelId === 'anthropic/claude-opus-4.7',
    );
    expect(hidden).toBeUndefined();
  });

  it('includes openrouter rows with visible=1', async () => {
    const { getDb } = await import('../database/db');
    const db = getDb();
    db.prepare(
      `INSERT OR REPLACE INTO agent_model_visibility (provider, model_id, visible) VALUES ('openrouter', 'anthropic/claude-sonnet-4.6', 1)`,
    ).run();

    const res = await fetch(`${baseUrl}/agents/models/catalog`, {
      headers: authHeaders,
    });
    const rows = await res.json() as Array<Record<string, unknown>>;
    const visible = rows.find(
      (r) => r.provider === 'openrouter' && r.modelId === 'anthropic/claude-sonnet-4.6',
    );
    expect(visible).toBeDefined();
  });

  it('includes curated openrouter models not in the hardcoded fallback list', async () => {
    mockAuthedProviders.push('openrouter');

    // Extend the OpenRouter mock catalog with a model NOT in ROUTE_FALLBACKS_BY_AGENT.
    const { opencodeClient } = await import('../services/opencode_engine');
    const mockListModels = vi.mocked(opencodeClient.listModels);
    const origImpl = mockListModels.getMockImplementation()!;
    try {
      mockListModels.mockImplementation(
        async (providerId: string) => {
          const base = (await origImpl(providerId)) as Array<{ id: string }>;
          if (providerId === 'openrouter') {
            return [...base, { id: 'custom/qwen-2.5-72b' }];
          }
          return base;
        },
      );

      const { getDb } = await import('../database/db');
      getDb().prepare(
        `INSERT OR REPLACE INTO agent_model_visibility (provider, model_id, visible) VALUES ('openrouter', 'custom/qwen-2.5-72b', 1)`,
      ).run();

      const res = await fetch(`${baseUrl}/agents/models/catalog`, {
        headers: authHeaders,
      });
      const rows = await res.json() as Array<Record<string, unknown>>;
      const curated = rows.find(
        (r) => r.provider === 'openrouter' && r.modelId === 'custom/qwen-2.5-72b',
      );
      expect(curated).toBeDefined();
      expect(curated?.authorized).toBe(true);
      expect(curated?.route).toBe('aggregator');
      // Verify it derives the correct agent from the model ID prefix ("custom/" → claude-code default).
      expect(curated?.agent).toBe('claude-code');
    } finally {
      mockListModels.mockImplementation(origImpl);
    }
  });

  it('filters out hardcoded fallback rows missing from the live provider catalog', async () => {
    mockAuthedProviders.push('openai');

    const res = await fetch(`${baseUrl}/agents/models/catalog`, {
      headers: authHeaders,
    });
    const rows = await res.json() as Array<Record<string, unknown>>;

    expect(rows.find((r) => r.provider === 'openai' && r.modelId === 'gpt-5-mini')).toBeUndefined();
    expect(rows.find((r) => r.provider === 'openai' && r.modelId === 'gpt-5.4-mini')).toBeDefined();
  });

  it('includes contextLimit for models where the SDK reports a limit', async () => {
    mockAuthedProviders.push('anthropic');

    const res = await fetch(`${baseUrl}/agents/models/catalog`, {
      headers: authHeaders,
    });
    const rows = await res.json() as Array<Record<string, unknown>>;

    // All anthropic rows should have contextLimit: 200000 per mock.
    const anthropicRows = rows.filter((r) => r.provider === 'anthropic');
    expect(anthropicRows.length).toBeGreaterThan(0);
    for (const row of anthropicRows) {
      expect(row.contextLimit).toBe(200000);
    }

    // OpenAI rows have no contextLimit in the mock — field must be absent.
    const openaiRows = rows.filter((r) => r.provider === 'openai');
    expect(openaiRows.length).toBeGreaterThan(0);
    for (const row of openaiRows) {
      expect(row.contextLimit).toBeUndefined();
    }
  });

  it('issue-live-engine-model-catalog-c1: includes live-only direct models with the correct agent mappings', async () => {
    // CONTRACT TEST — catches the regression where the route starts from
    // ROUTE_FALLBACKS_BY_AGENT and uses the live inventory only as a filter.
    mockAuthedProviders.push('anthropic', 'openai', 'google');
    const { opencodeClient } = await import('../services/opencode_engine');
    const mockListModels = vi.mocked(opencodeClient.listModels);
    const original = mockListModels.getMockImplementation()!;
    try {
      mockListModels.mockImplementation(async (providerId: string) => {
        const models = (await original(providerId)) as Array<{ id: string; contextLimit?: number }>;
        if (providerId === 'anthropic') {
          return [...models, { id: 'claude-opus-4-8', contextLimit: 1_000_000 }];
        }
        if (providerId === 'openai') {
          return [...models, { id: 'gpt-5.5', contextLimit: 1_000_000 }];
        }
        if (providerId === 'google') {
          return [...models, { id: 'gemini-3.5-flash', contextLimit: 1_048_576 }];
        }
        return models;
      });

      const res = await fetch(`${baseUrl}/agents/models/catalog`, {
        headers: authHeaders,
      });
      expect(res.status).toBe(200);
      const rows = await res.json() as Array<Record<string, unknown>>;

      expect(rows).toContainEqual(expect.objectContaining({
        agent: 'claude-code',
        provider: 'anthropic',
        modelId: 'claude-opus-4-8',
        route: 'direct',
        authorized: true,
      }));
      expect(rows).toContainEqual(expect.objectContaining({
        agent: 'codex',
        provider: 'openai',
        modelId: 'gpt-5.5',
        route: 'direct',
        authorized: true,
      }));
      expect(rows).toContainEqual(expect.objectContaining({
        agent: 'gemini-cli',
        provider: 'google',
        modelId: 'gemini-3.5-flash',
        route: 'direct',
        authorized: true,
      }));
    } finally {
      mockListModels.mockImplementation(original);
    }
  });

  it('issue-live-engine-model-catalog-c2: keeps hardcoded fallback rows when live catalogs are empty', async () => {
    // CONTRACT TEST — catches a startup/network regression where dynamic
    // discovery replaces the fallback list and an empty SDK response empties
    // the picker.
    const { opencodeClient } = await import('../services/opencode_engine');
    const mockListModels = vi.mocked(opencodeClient.listModels);
    const original = mockListModels.getMockImplementation()!;
    try {
      mockListModels.mockResolvedValue([]);

      const res = await fetch(`${baseUrl}/agents/models/catalog`, {
        headers: authHeaders,
      });
      expect(res.status).toBe(200);
      const rows = await res.json() as Array<Record<string, unknown>>;

      expect(rows).toContainEqual(expect.objectContaining({
        agent: 'claude-code',
        provider: 'anthropic',
        modelId: 'claude-sonnet-4-6',
        route: 'direct',
      }));
      expect(rows).toContainEqual(expect.objectContaining({
        agent: 'codex',
        provider: 'openai',
        modelId: 'gpt-5.4',
        route: 'direct',
      }));
      expect(rows).toContainEqual(expect.objectContaining({
        agent: 'gemini-cli',
        provider: 'google',
        modelId: 'gemini-2.5-pro',
        route: 'direct',
      }));
    } finally {
      mockListModels.mockImplementation(original);
    }
  });

  it('issue-live-engine-model-catalog-c3: dedupes direct rows and preserves direct-auth OpenRouter suppression', async () => {
    // CONTRACT TEST — catches a naive live-catalog union that duplicates an
    // existing fallback row or reintroduces the equivalent OpenRouter route.
    mockAuthedProviders.push('anthropic', 'openrouter');

    const res = await fetch(`${baseUrl}/agents/models/catalog`, {
      headers: authHeaders,
    });
    expect(res.status).toBe(200);
    const rows = await res.json() as Array<Record<string, unknown>>;

    const direct = rows.filter(
      (row) =>
        row.provider === 'anthropic' &&
        row.modelId === 'claude-opus-4-7' &&
        row.route === 'direct',
    );
    const duplicateAggregator = rows.filter(
      (row) =>
        row.provider === 'openrouter' &&
        row.modelId === 'anthropic/claude-opus-4.7',
    );
    expect(direct).toHaveLength(1);
    expect(duplicateAggregator).toHaveLength(0);
  });

  it('issue-live-engine-model-catalog-c4: excludes specialized and generated fast models from live discovery', async () => {
    // CONTRACT TEST — catches an unfiltered live-catalog union that exposes
    // embedding, TTS, image, or generated -fast rows in the coding picker.
    mockAuthedProviders.push('anthropic', 'openai', 'google');
    const { opencodeClient } = await import('../services/opencode_engine');
    const mockListModels = vi.mocked(opencodeClient.listModels);
    const original = mockListModels.getMockImplementation()!;
    try {
      mockListModels.mockImplementation(async (providerId: string) => {
        const models = (await original(providerId)) as Array<{ id: string }>;
        if (providerId === 'anthropic') {
          return [
            ...models,
            { id: 'claude-opus-4-8' },
            { id: 'claude-opus-4-8-fast' },
          ];
        }
        if (providerId === 'openai') {
          return [
            ...models,
            { id: 'gpt-5.5' },
            { id: 'gpt-5.5-fast' },
            { id: 'text-embedding-3-small' },
          ];
        }
        if (providerId === 'google') {
          return [
            ...models,
            { id: 'gemini-3.5-flash' },
            { id: 'gemini-2.5-flash-preview-tts' },
            { id: 'gemini-3-pro-image-preview' },
          ];
        }
        return models;
      });

      const res = await fetch(`${baseUrl}/agents/models/catalog`, {
        headers: authHeaders,
      });
      expect(res.status).toBe(200);
      const rows = await res.json() as Array<Record<string, unknown>>;
      const directIds = rows
        .filter((row) => row.route === 'direct')
        .map((row) => `${row.provider}/${row.modelId}`);

      // Prove the live inventory was admitted before checking its filter.
      expect(directIds).toContain('openai/gpt-5.5');
      expect(directIds).not.toContain('anthropic/claude-opus-4-8-fast');
      expect(directIds).not.toContain('openai/gpt-5.5-fast');
      expect(directIds).not.toContain('openai/text-embedding-3-small');
      expect(directIds).not.toContain('google/gemini-2.5-flash-preview-tts');
      expect(directIds).not.toContain('google/gemini-3-pro-image-preview');
    } finally {
      mockListModels.mockImplementation(original);
    }
  });

  it('issue-live-engine-model-catalog-c5: composes the real HTTP route over the opencode inventory boundary', async () => {
    // CONTRACT TEST — the Express route is real; only the external opencode
    // inventory/auth boundary is mocked. This catches route composition that
    // never promotes a live-only provider model.
    mockAuthedProviders.push('anthropic');
    const { opencodeClient } = await import('../services/opencode_engine');
    const mockListModels = vi.mocked(opencodeClient.listModels);
    const original = mockListModels.getMockImplementation()!;
    try {
      mockListModels.mockImplementation(async (providerId: string) => {
        const models = (await original(providerId)) as Array<{ id: string }>;
        return providerId === 'anthropic'
          ? [...models, { id: 'claude-opus-4-8' }]
          : models;
      });

      const res = await fetch(`${baseUrl}/agents/models/catalog`, {
        headers: authHeaders,
      });
      expect(res.status).toBe(200);
      const rows = await res.json() as Array<Record<string, unknown>>;
      expect(rows).toContainEqual(expect.objectContaining({
        provider: 'anthropic',
        modelId: 'claude-opus-4-8',
        agent: 'claude-code',
        route: 'direct',
      }));
    } finally {
      mockListModels.mockImplementation(original);
    }
  });

  it('issue-live-engine-model-catalog-c6: fails on a missing live-only row after a successful route response', async () => {
    // CONTRACT TEST — status 200 proves setup and route execution succeeded;
    // the missing gpt-5.5-pro assertion isolates the current hardcoded-list bug.
    mockAuthedProviders.push('openai');
    const { opencodeClient } = await import('../services/opencode_engine');
    const mockListModels = vi.mocked(opencodeClient.listModels);
    const original = mockListModels.getMockImplementation()!;
    try {
      mockListModels.mockImplementation(async (providerId: string) => {
        const models = (await original(providerId)) as Array<{ id: string }>;
        return providerId === 'openai'
          ? [...models, { id: 'gpt-5.5-pro' }]
          : models;
      });

      const res = await fetch(`${baseUrl}/agents/models/catalog`, {
        headers: authHeaders,
      });
      expect(res.status).toBe(200);
      const rows = await res.json() as Array<Record<string, unknown>>;
      expect(rows).toContainEqual(expect.objectContaining({
        provider: 'openai',
        modelId: 'gpt-5.5-pro',
        agent: 'codex',
        route: 'direct',
      }));
    } finally {
      mockListModels.mockImplementation(original);
    }
  });

  it('issue-1139-custom-provider-c1: surfaces a custom opencode.json provider (glm-mesh) as an opencode-kind direct row', async () => {
    // CONTRACT TEST for #1143 — a provider defined only in opencode.json is in
    // the engine's live catalog (listProviders) but absent from both static
    // maps, so it never appeared in the picker. It must now surface as a
    // generic `opencode`-kind direct row, authorized (config-defined = usable).
    const { opencodeClient } = await import('../services/opencode_engine');
    const mockListProviders = vi.mocked(opencodeClient.listProviders);
    const original = mockListProviders.getMockImplementation()!;
    try {
      mockListProviders.mockResolvedValue([
        { id: 'anthropic', models: [] },
        { id: 'openai', models: [] },
        { id: 'openrouter', models: [] },
        { id: 'glm-mesh', models: [{ id: 'glm-4.6', contextLimit: 131072 }] },
      ]);

      const res = await fetch(`${baseUrl}/agents/models/catalog`, { headers: authHeaders });
      expect(res.status).toBe(200);
      const rows = (await res.json()) as Array<Record<string, unknown>>;

      const glm = rows.find((r) => r.provider === 'glm-mesh' && r.modelId === 'glm-4.6');
      expect(glm).toBeDefined();
      expect(glm?.agent).toBe('opencode');
      expect(glm?.route).toBe('direct');
      expect(glm?.authorized).toBe(true);
      expect(glm?.contextLimit).toBe(131072);
    } finally {
      mockListProviders.mockImplementation(original);
    }
  });

  it('issue-001-c6: marks an engine-advertised provider unauthorized when it is absent from auth and opencode.json', async () => {
    // CONTRACT TEST — catches the false authorization that let a Zen override
    // pass validation, create a child, and fail later with provider 401.
    const { opencodeClient } = await import('../services/opencode_engine');
    const mockListProviders = vi.mocked(opencodeClient.listProviders);
    const original = mockListProviders.getMockImplementation()!;
    try {
      mockListProviders.mockResolvedValue([
        { id: 'opencode', models: [{ id: 'north-mini-code-free' }] },
      ]);

      const res = await fetch(`${baseUrl}/agents/models/catalog`, { headers: authHeaders });
      expect(res.status).toBe(200);
      const rows = (await res.json()) as Array<Record<string, unknown>>;
      expect(rows).toContainEqual(expect.objectContaining({
        provider: 'opencode',
        modelId: 'north-mini-code-free',
        authorized: false,
      }));
    } finally {
      mockListProviders.mockImplementation(original);
    }
  });

  it('issue-1139-custom-provider-c3: GET /agents/models?agentId=opencode includes the custom provider', async () => {
    // The per-agent picker endpoint (not just /catalog) must also surface a
    // custom provider under the generic `opencode` agent kind.
    const { opencodeClient } = await import('../services/opencode_engine');
    const mockListProviders = vi.mocked(opencodeClient.listProviders);
    const original = mockListProviders.getMockImplementation()!;
    try {
      mockListProviders.mockResolvedValue([
        { id: 'glm-mesh', models: [{ id: 'glm-4.6', contextLimit: 131072 }] },
      ]);

      const res = await fetch(`${baseUrl}/agents/models?agentId=opencode`, { headers: authHeaders });
      expect(res.status).toBe(200);
      const rows = (await res.json()) as Array<Record<string, unknown>>;
      const glm = rows.find((r) => r.providerId === 'glm-mesh' && r.modelId === 'glm-4.6');
      expect(glm).toBeDefined();
      expect(glm?.routeKind).toBe('direct');
    } finally {
      mockListProviders.mockImplementation(original);
    }
  });

  it('issue-1139-custom-provider-c4: a custom provider does NOT leak into a non-opencode agent picker', async () => {
    // Custom providers map to `opencode` only — asking for claude-code must not
    // return glm-mesh rows.
    const { opencodeClient } = await import('../services/opencode_engine');
    const mockListProviders = vi.mocked(opencodeClient.listProviders);
    const original = mockListProviders.getMockImplementation()!;
    try {
      mockListProviders.mockResolvedValue([
        { id: 'glm-mesh', models: [{ id: 'glm-4.6', contextLimit: 131072 }] },
      ]);
      const res = await fetch(`${baseUrl}/agents/models?agentId=claude-code`, { headers: authHeaders });
      const rows = (await res.json()) as Array<Record<string, unknown>>;
      expect(rows.find((r) => r.providerId === 'glm-mesh')).toBeUndefined();
    } finally {
      mockListProviders.mockImplementation(original);
    }
  });

  it('issue-1139-custom-provider-c2: does not double-emit a provider already in the static maps', async () => {
    // If listProviders returns a KNOWN provider (anthropic), the custom-merge
    // must NOT add duplicate rows for it — the static/live-direct loops own it.
    mockAuthedProviders.push('anthropic');
    const { opencodeClient } = await import('../services/opencode_engine');
    const mockListProviders = vi.mocked(opencodeClient.listProviders);
    const original = mockListProviders.getMockImplementation()!;
    try {
      // anthropic reports a model via listProviders too — must not duplicate
      // the row the live-direct loop already emits from listModels.
      mockListProviders.mockResolvedValue([
        { id: 'anthropic', models: [{ id: 'claude-opus-4-7', contextLimit: 200000 }] },
      ]);

      const res = await fetch(`${baseUrl}/agents/models/catalog`, { headers: authHeaders });
      const rows = (await res.json()) as Array<Record<string, unknown>>;
      const dupes = rows.filter(
        (r) => r.provider === 'anthropic' && r.modelId === 'claude-opus-4-7' && r.route === 'direct',
      );
      expect(dupes).toHaveLength(1);
    } finally {
      mockListProviders.mockImplementation(original);
    }
  });

  afterEach(async () => {
    await closeServer();
    vi.clearAllMocks();
  });
});
