/**
 * Acceptance contract for issue #637 — curated OpenRouter visibility
 * inconsistent between GET /agents/models?agentId=... and GET /agents/models/catalog.
 *
 * These tests MUST fail before implementation and pass after the fix.
 *
 * Diagnosis:
 *  - c1: `GET /agents/models?agentId=claude-code` only iterates
 *        ROUTE_FALLBACKS_BY_AGENT. Curated OpenRouter rows stored in
 *        `agent_model_visibility` with `visible=1` are never appended to the
 *        response, even when the SDK live catalog confirms the model exists.
 *        The fix must mirror the "curatedEntries" promotion block already
 *        present in the `/catalog` handler.
 *
 * c2 is tested in the Flutter contract test (manual mode — see contract JSON).
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import type { AddressInfo } from 'node:net';
import { createApp } from '../app';
import { runMigrations } from '../database/migrations';
import { setDb, getDb } from '../database/db';
import { UsersRepository } from '../repositories/users_repository';
import { SessionsRepository } from '../repositories/sessions_repository';

// ---------------------------------------------------------------------------
// Mock the opencode engine so the SDK OpenRouter catalog is non-empty and
// includes `meta-llama/llama-3.3-70b-instruct` — the curated model we seed
// below. listAuthedProviders returns ['openrouter'] to match a user who has
// configured OpenRouter but not a direct Anthropic account.
// ---------------------------------------------------------------------------
vi.mock('../services/opencode_engine', () => {
  const mockClient = {
    isReady: true,
    listProviders: vi.fn().mockResolvedValue([]),
    listModels: vi.fn().mockImplementation((providerId: string) => {
      const byProvider: Record<string, Array<{ id: string }>> = {
        // Anthropic not authed in this scenario.
        anthropic: [],
        openrouter: [
          { id: 'meta-llama/llama-3.3-70b-instruct' },
          { id: 'anthropic/claude-opus-4.7' },
        ],
      };
      return Promise.resolve(byProvider[providerId] ?? []);
    }),
    listAuthedProviders: vi.fn().mockResolvedValue(['openrouter']),
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

describe('issue-637-c1: GET /agents/models?agentId=claude-code must include SDK-confirmed curated openrouter ids', () => {
  let baseUrl: string;
  let authHeaders: Record<string, string>;
  let closeServer: () => Promise<void>;

  beforeEach(async () => {
    setDb(makeDb());
    const user = new UsersRepository().create({
      name: 'Test',
      email: 'test-637@example.com',
    });
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

  afterEach(async () => {
    await closeServer();
  });

  it('includes a curated visible openrouter model confirmed by the SDK live catalog', async () => {
    // CONTRACT TEST — must fail before implementation.
    //
    // The current GET / handler only iterates ROUTE_FALLBACKS_BY_AGENT.
    // `meta-llama/llama-3.3-70b-instruct` is NOT in that list but IS in the
    // SDK live catalog (mocked above) and IS marked visible=1 in the DB.
    //
    // The fix must append a "curatedEntries" promotion block (mirroring what
    // the /catalog handler already does) so these rows appear in the response.
    const db = getDb();
    db.prepare(
      `INSERT OR REPLACE INTO agent_model_visibility (provider, model_id, visible)
       VALUES ('openrouter', 'meta-llama/llama-3.3-70b-instruct', 1)`,
    ).run();

    const res = await fetch(
      `${baseUrl}/agents/models?agentId=claude-code`,
      { headers: authHeaders },
    );
    expect(res.status).toBe(200);

    type ModelRow = { modelId?: string; providerId?: string };
    const rows = (await res.json()) as ModelRow[];

    const curated = rows.find(
      (r) => r.modelId === 'meta-llama/llama-3.3-70b-instruct',
    );

    // THIS IS THE FAILING ASSERTION before the fix.
    // The GET / handler never reads agent_model_visibility, so the curated
    // entry is absent even though /catalog would include it.
    expect(curated).toBeDefined();
  });

  it('does NOT include a curated visible openrouter model that the SDK cannot confirm', async () => {
    // Regression guard — the fix must still require SDK confirmation.
    // `some-provider/made-up-model` is marked visible=1 but is NOT in the
    // mock SDK catalog; it must remain absent.
    const db = getDb();
    db.prepare(
      `INSERT OR REPLACE INTO agent_model_visibility (provider, model_id, visible)
       VALUES ('openrouter', 'some-provider/made-up-model', 1)`,
    ).run();

    const res = await fetch(
      `${baseUrl}/agents/models?agentId=claude-code`,
      { headers: authHeaders },
    );
    expect(res.status).toBe(200);

    type ModelRow = { modelId?: string };
    const rows = (await res.json()) as ModelRow[];

    const unconfirmed = rows.find(
      (r) => r.modelId === 'some-provider/made-up-model',
    );
    expect(unconfirmed).toBeUndefined();
  });

  it('does NOT include a curated openrouter model with visible=0', async () => {
    // Regression guard — hidden curated models must never surface.
    const db = getDb();
    db.prepare(
      `INSERT OR REPLACE INTO agent_model_visibility (provider, model_id, visible)
       VALUES ('openrouter', 'meta-llama/llama-3.3-70b-instruct', 0)`,
    ).run();

    const res = await fetch(
      `${baseUrl}/agents/models?agentId=claude-code`,
      { headers: authHeaders },
    );
    expect(res.status).toBe(200);

    type ModelRow = { modelId?: string };
    const rows = (await res.json()) as ModelRow[];

    const hidden = rows.find(
      (r) => r.modelId === 'meta-llama/llama-3.3-70b-instruct',
    );
    expect(hidden).toBeUndefined();
  });
});
