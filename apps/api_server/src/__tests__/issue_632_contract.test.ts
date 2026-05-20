/**
 * Acceptance contract for issue #632 — OpenRouter models in the per-turn
 * picker silently no-op when invoked.
 *
 * These tests MUST fail before implementation and pass after the fix.
 *
 * Diagnosis (from failure-triage):
 *  - c1: `OpencodeClientService.promptAsync` returns `true` when the SDK
 *        replies with an empty object (no error, no data). The contract
 *        requires it to return `false` so the WS gateway can surface an
 *        error frame instead of leaving the user hanging.
 *  - c2: `GET /agents/models` promotes curated OpenRouter visibility rows
 *        into the picker catalog even when the SDK's live OpenRouter model
 *        list is empty (skipLiveCheck=true bypass). The contract requires
 *        that an unrecognized id NOT be promoted when no live catalog
 *        confirmation is possible — defer rather than admit bad ids.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import type { AddressInfo } from 'node:net';
import { OpencodeClientService } from '../services/opencode_client_service';
import { createApp } from '../app';
import { runMigrations } from '../database/migrations';
import { setDb, getDb } from '../database/db';
import { UsersRepository } from '../repositories/users_repository';
import { SessionsRepository } from '../repositories/sessions_repository';

// Mock the opencode engine so its model catalog is empty for openrouter
// (matching the early-startup state where skipLiveCheck=true takes effect).
vi.mock('../services/opencode_engine', () => {
  const mockClient = {
    isReady: true,
    listProviders: vi.fn().mockResolvedValue([]),
    listModels: vi.fn().mockImplementation((providerId: string) => {
      // openrouter intentionally empty — triggers skipLiveCheck=true path.
      const byProvider: Record<string, Array<{ id: string }>> = {
        anthropic: [{ id: 'claude-opus-4-7' }],
        openrouter: [],
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

describe('issue-632-c1: promptAsync must not report success when SDK silently no-ops', () => {
  it('returns false when SDK response carries neither data nor error', async () => {
    // CONTRACT TEST — must fail before implementation.
    // Current code returns true when raw.error is falsy, even if raw.data
    // is also missing. That makes WS gateway treat an unknown-model
    // silent no-op as a success.
    const service = new OpencodeClientService();
    // Inject a fake SDK client that simulates the silent-no-op response
    // that real OpenRouter returns for unrecognized model ids.
    (service as unknown as { client: unknown }).client = {
      session: {
        // Empty object — no error, no data, no throw.
        promptAsync: async () => ({} as { data?: unknown; error?: unknown }),
      },
    };

    const result = await service.promptAsync(
      'sid-1',
      'hello',
      { providerID: 'openrouter', modelID: 'bogus/unknown-model' },
    );

    expect(result).toBe(false);
  });

  it('returns true when SDK response includes a data envelope', async () => {
    // Regression guard — the fix must not break the happy path.
    const service = new OpencodeClientService();
    (service as unknown as { client: unknown }).client = {
      session: {
        promptAsync: async () => ({ data: { ok: true } }),
      },
    };

    const result = await service.promptAsync(
      'sid-2',
      'hello',
      { providerID: 'anthropic', modelID: 'claude-opus-4-7' },
    );

    expect(result).toBe(true);
  });
});

describe('issue-632-c2: GET /agents/models must not promote curated openrouter ids when live catalog is empty', () => {
  let baseUrl: string;
  let authHeaders: Record<string, string>;
  let closeServer: () => Promise<void>;

  beforeEach(async () => {
    setDb(makeDb());
    const user = new UsersRepository().create({
      name: 'Test',
      email: 'test@example.com',
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

  it('excludes curated openrouter rows the SDK cannot confirm', async () => {
    // CONTRACT TEST — must fail before implementation.
    // The mock above returns an EMPTY openrouter model list, which triggers
    // skipLiveCheck=true in agents_models_routes.ts. The current code admits
    // the curated entry below into the picker; selecting it produces the
    // silent no-op #632 reports. The fix must drop the entry until the SDK
    // catalog confirms it.
    const db = getDb();
    db.prepare(
      `INSERT OR REPLACE INTO agent_model_visibility (provider, model_id, visible)
       VALUES ('openrouter', 'meta-llama/llama-3-bogus-id', 1)`,
    ).run();

    const res = await fetch(`${baseUrl}/agents/models/catalog`, {
      headers: authHeaders,
    });
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<Record<string, unknown>>;
    const promoted = rows.find(
      (r) =>
        r.provider === 'openrouter' &&
        r.modelId === 'meta-llama/llama-3-bogus-id',
    );
    expect(promoted).toBeUndefined();

    await closeServer();
  });
});
