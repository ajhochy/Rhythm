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
import type { AddressInfo } from 'node:net';
import { UsersRepository } from '../repositories/users_repository';
import { SessionsRepository } from '../repositories/sessions_repository';

// Provide a controllable authed-providers list.
const mockAuthedProviders: string[] = [];

vi.mock('../services/opencode_engine', () => {
  const mockClient = {
    isReady: true,
    listProviders: vi.fn().mockResolvedValue([]),
    listModels: vi.fn().mockImplementation((providerId: string) => {
      const byProvider: Record<string, Array<{ id: string; name?: string }>> = {
        anthropic: [
          { id: 'claude-opus-4-7' },
          { id: 'claude-opus-4-5' },
          { id: 'claude-sonnet-4-6' },
          { id: 'claude-haiku-4-5' },
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

    const server = createApp().listen(0);
    await new Promise<void>((r) => server.once('listening', () => r()));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
    closeServer = () =>
      new Promise<void>((res, rej) =>
        server.close((e) => (e ? rej(e) : res())),
      );
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

  afterEach(async () => {
    await closeServer();
    vi.clearAllMocks();
  });
});
