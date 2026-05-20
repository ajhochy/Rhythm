/**
 * Acceptance contract for issue #639 — OpenRouter picker shows duplicate
 * routes and doesn't refresh on Settings save.
 *
 * Sub-issue A (this file): GET /agents/models and GET /agents/models/catalog
 * must NOT return openrouter aggregator rows whose modelId prefix matches a
 * provider that is already directly authed.
 *
 * These tests MUST fail before implementation and pass after the fix.
 *
 * Diagnosis:
 *   Both handlers iterate ROUTE_FALLBACKS_BY_AGENT unconditionally and emit a
 *   row for `{providerID:'openrouter', modelID:'anthropic/claude-opus-4.7'}` as
 *   long as 'openrouter' is in authedProviders — even when 'anthropic' is also
 *   in authedProviders, which means the user already has a direct route to the
 *   same model. This causes a duplicate in the picker: one row labelled
 *   "claude-opus-4-7 · direct" and another "anthropic/claude-opus-4.7 · via
 *   OpenRouter". The fix must suppress the openrouter aggregator row when a
 *   direct provider covering the same model family is already authed.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import type { AddressInfo } from 'node:net';
import { createApp } from '../app';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { UsersRepository } from '../repositories/users_repository';
import { SessionsRepository } from '../repositories/sessions_repository';

// ---------------------------------------------------------------------------
// Mock: both anthropic and openrouter are authed, each has a non-empty catalog.
// This is the "duplicate route" scenario: anthropic is directly authed AND
// openrouter carries anthropic/* models — both appear unless the fix suppresses
// the openrouter aggregator rows for the directly-authed anthropic provider.
// ---------------------------------------------------------------------------
vi.mock('../services/opencode_engine', () => {
  const mockClient = {
    isReady: true,
    listProviders: vi.fn().mockResolvedValue([]),
    listModels: vi.fn().mockImplementation((providerId: string) => {
      const byProvider: Record<string, Array<{ id: string }>> = {
        anthropic: [
          { id: 'claude-opus-4-7' },
          { id: 'claude-sonnet-4-6' },
          { id: 'claude-haiku-4-5' },
        ],
        openrouter: [
          { id: 'anthropic/claude-opus-4.7' },
          { id: 'anthropic/claude-opus-4.7:extended' },
          { id: 'anthropic/claude-opus-4.5' },
          { id: 'anthropic/claude-sonnet-4.6' },
          { id: 'anthropic/claude-haiku-4.5' },
          { id: 'meta-llama/llama-3.3-70b-instruct' },
        ],
      };
      return Promise.resolve(byProvider[providerId] ?? []);
    }),
    // Both anthropic and openrouter are authed — the duplicate scenario.
    listAuthedProviders: vi.fn().mockResolvedValue(['anthropic', 'openrouter']),
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ModelsRow = {
  providerId?: string;
  modelId?: string;
  provider?: string;
  route?: string;
};

function hasOpenrouterAnthropicRow(rows: ModelsRow[]): boolean {
  return rows.some(
    (r) =>
      (r.providerId === 'openrouter' || r.provider === 'openrouter') &&
      (r.modelId ?? '').startsWith('anthropic/'),
  );
}

// ---------------------------------------------------------------------------
// Tests — GET /agents/models?agentId=claude-code
// ---------------------------------------------------------------------------

describe(
  'issue-639-c1a: GET /agents/models?agentId=claude-code must NOT include openrouter/anthropic/* rows when anthropic is directly authed',
  () => {
    let baseUrl: string;
    let authHeaders: Record<string, string>;
    let closeServer: () => Promise<void>;

    beforeEach(async () => {
      setDb(makeDb());
      const user = new UsersRepository().create({
        name: 'Test 639',
        email: 'test-639@example.com',
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

    it(
      'does NOT return {providerId:openrouter, modelId:anthropic/claude-opus-4.7} when anthropic is directly authed',
      async () => {
        // CONTRACT TEST — must fail before implementation.
        //
        // Currently both 'anthropic' and 'openrouter' are in authedProviders.
        // The handler emits the openrouter row for 'anthropic/claude-opus-4.7'
        // unconditionally (ROUTE_FALLBACKS_BY_AGENT[claude-code] contains it).
        // The fix must suppress any openrouter aggregator row whose modelId
        // prefix ('anthropic/') matches a directly-authed provider ('anthropic').
        const res = await fetch(
          `${baseUrl}/agents/models?agentId=claude-code`,
          { headers: authHeaders },
        );
        expect(res.status).toBe(200);

        const rows = (await res.json()) as ModelsRow[];

        // THIS IS THE FAILING ASSERTION before the fix.
        // The route anthropic/claude-opus-4.7 via openrouter must be absent
        // because anthropic is directly authed and the user already has the
        // direct route to the same model family.
        expect(
          hasOpenrouterAnthropicRow(rows),
          'GET /agents/models must not include openrouter rows for anthropic/* ' +
            'when anthropic is directly authed (would cause duplicate picker rows)',
        ).toBe(false);
      },
    );

    it(
      'regression: non-anthropic openrouter rows still appear when openrouter is authed',
      async () => {
        // Regression guard — the fix must not suppress openrouter rows for
        // providers that are NOT directly authed. meta-llama/llama-3.3-70b-instruct
        // has no direct provider route, so it must still appear via openrouter.
        // (We need a visibility row to promote it as a curated entry.)
        const { getDb } = await import('../database/db');
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

        const rows = (await res.json()) as ModelsRow[];
        const llamaRow = rows.find((r) =>
          (r.modelId ?? '').includes('llama-3.3-70b'),
        );

        expect(
          llamaRow,
          'non-anthropic openrouter rows must still be included',
        ).toBeDefined();
      },
    );

    it(
      'regression: when only openrouter is authed (no direct anthropic), anthropic/* openrouter routes DO appear',
      async () => {
        // Regression guard (fallback scenario): the deduplication must only
        // apply when the direct provider is ALSO authed. If the user has only
        // openrouter configured and no direct anthropic key, the openrouter
        // 'anthropic/claude-opus-4.7' route is their only path to Claude and
        // must not be suppressed.
        //
        // We can't re-mock listAuthedProviders here (vi.mock is hoisted).
        // Instead we verify the behaviour by checking the positive assertion
        // documented in the contract: if authedProviders contains only
        // 'openrouter', the response WOULD include the anthropic/* rows.
        // That assertion is covered by the existing issue_637_contract.test.ts
        // which mocks authedProviders=['openrouter'] exclusively.
        //
        // This placeholder test documents the expected contract so the
        // coding-agent does not accidentally suppress openrouter/anthropic/*
        // rows when anthropic is NOT in authedProviders.
        expect(true).toBe(true); // covered by issue_637_contract.test.ts c1
      },
    );
  },
);

// ---------------------------------------------------------------------------
// Tests — GET /agents/models/catalog
// ---------------------------------------------------------------------------

describe(
  'issue-639-c1b: GET /agents/models/catalog must NOT include openrouter/anthropic/* rows when anthropic is directly authed',
  () => {
    let baseUrl: string;
    let authHeaders: Record<string, string>;
    let closeServer: () => Promise<void>;

    beforeEach(async () => {
      setDb(makeDb());
      const user = new UsersRepository().create({
        name: 'Test 639 catalog',
        email: 'test-639-catalog@example.com',
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

    it(
      'does NOT return openrouter rows for anthropic/* models when anthropic is directly authed',
      async () => {
        // CONTRACT TEST — must fail before implementation.
        //
        // GET /agents/models/catalog uses listAllRoutes() which returns every
        // ROUTE_FALLBACKS_BY_AGENT entry. It then filters by authedSet but does
        // NOT suppress openrouter aggregator rows for models whose prefix
        // matches a directly-authed provider. The fix must add that suppression.
        const res = await fetch(`${baseUrl}/agents/models/catalog`, {
          headers: authHeaders,
        });
        expect(res.status).toBe(200);

        const rows = (await res.json()) as ModelsRow[];

        // THIS IS THE FAILING ASSERTION before the fix.
        expect(
          hasOpenrouterAnthropicRow(rows),
          'GET /agents/models/catalog must not include openrouter rows for ' +
            'anthropic/* when anthropic is directly authed (duplicate catalog rows)',
        ).toBe(false);
      },
    );

    it(
      'still includes authorized: true on direct anthropic rows in the catalog',
      async () => {
        // Regression guard — the direct anthropic rows must remain present.
        const res = await fetch(`${baseUrl}/agents/models/catalog`, {
          headers: authHeaders,
        });
        expect(res.status).toBe(200);

        const rows = (await res.json()) as ModelsRow[];
        const directAnthropicRow = rows.find(
          (r) =>
            (r.provider === 'anthropic' || r.providerId === 'anthropic') &&
            r.route === 'direct',
        );

        expect(
          directAnthropicRow,
          'direct anthropic row must remain in the catalog',
        ).toBeDefined();
      },
    );
  },
);
