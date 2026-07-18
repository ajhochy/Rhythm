/**
 * Acceptance-contract tests for issue #638 — c4
 *
 * Root cause: `streamBridge.streamSession(...)` is fire-and-forget in
 * `agent_sessions_controller.ts` (lines 251-258). The controller calls
 * `promptAsync` at line 272 without awaiting `streamSession`. Because
 * `streamSession` internally awaits `subscribeToEvents` before entering the
 * `_listen` for-await loop, any SDK events emitted during the window between
 * `promptAsync` firing and `subscribeToEvents` resolving are never seen by the
 * listener — they are silently dropped.
 *
 * Contract (c4):
 *   1. `streamBridge.streamSession` MUST be awaited before `promptAsync` is
 *      invoked. If `streamSession` is still pending when the SDK starts
 *      emitting, events are dropped.
 *   2. When `session.error` fires and the bridge relays it, the broadcast
 *      frame's `id` MUST be the local session id (from the POST /agent-sessions
 *      response), NOT the SDK UUID.
 *
 * These tests MUST fail before the fix and pass after it.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { startTestServer } from './helpers/real_server';
import { setDb, getDb } from '../database/db';
import { UsersRepository } from '../repositories/users_repository';
import { SessionsRepository } from '../repositories/sessions_repository';

// ---------------------------------------------------------------------------
// Track call ordering between streamSession and promptAsync.
// The test will inspect this array to verify sequencing.
// ---------------------------------------------------------------------------

const callOrder: string[] = [];
let streamSessionResolve: (() => void) | undefined;

vi.mock('../services/opencode_stream_bridge', () => ({
  streamBridge: {
    streamSession: vi.fn(
      () =>
        new Promise<void>((resolve) => {
          callOrder.push('streamSession:called');
          // Hold the promise pending — simulates subscribeToEvents being slow.
          // The test will manually resolve it to check sequencing.
          streamSessionResolve = () => {
            callOrder.push('streamSession:resolved');
            resolve();
          };
        }),
    ),
    stopStream: vi.fn(),
    dispose: vi.fn(),
  },
}));

vi.mock('../services/opencode_engine', () => {
  const mockClient = {
    isReady: true,
    listModels: vi.fn().mockResolvedValue([]),
    listAuthedProviders: vi.fn().mockResolvedValue([]),
    statusMessage: 'ready',
    createSession: vi.fn().mockResolvedValue({ id: 'sdk-xxxx' }),
    setAuth: vi.fn().mockResolvedValue(true),
    promptAsync: vi.fn((..._args: unknown[]) => {
      callOrder.push('promptAsync:called');
      return Promise.resolve(true);
    }),
    subscribeToEvents: vi.fn().mockResolvedValue(null),
  };
  return {
    opencodeClient: mockClient,
    opencodeSessionMap: new Map<string, string>(),
  };
});

vi.mock('../services/ws_gateway', () => ({
  broadcast: vi.fn(),
  broadcastSessionUpdated: vi.fn(),
  broadcastSessionRemoved: vi.fn(),
}));

import { createApp } from '../app';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('agent_sessions_controller — issue #638-c4 streamSession must precede promptAsync', () => {
  let baseUrl: string;
  let authHeaders: Record<string, string>;
  let closeServer: () => Promise<void>;

  beforeEach(async () => {
    callOrder.length = 0;
    streamSessionResolve = undefined;

    setDb(makeDb());
    const user = new UsersRepository().create({
      name: 'Test',
      email: 'test@example.com',
    });
    const session = await new SessionsRepository().createAsync(user.id);
    authHeaders = { Authorization: `Bearer ${session.token}` };

    ({ baseUrl, close: closeServer } = await startTestServer(createApp()));
  });

  afterEach(async () => {
    await closeServer();
  });

  // -------------------------------------------------------------------------
  // c4-a (SUPERSEDED by #653): used to assert "promptAsync is called AFTER
  // streamSession resolves" — guarding the fire-and-forget race during the
  // auto-initial-prompt path. That whole path is removed in #653: the server
  // no longer fabricates a "I need help with: <title>" prompt at session
  // creation; the client owns first-turn content via composer prefill.
  // promptAsync is therefore not called from createSession at all, so the
  // ordering invariant the test guarded no longer has a trigger condition.
  // c4-b below still applies (response id is local UUID, not SDK id).
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // c4-b: POST /agent-sessions response includes the local session id.
  //       The error frame's id must match this local id, not 'sdk-xxxx'.
  //
  // This is a prerequisite check — verifies the response shape so c4-a's
  // local-id assertion is grounded in a real id value.
  // -------------------------------------------------------------------------

  it('issue-638-c4-b: POST response id is a local UUID, not the SDK session id', async () => {
    // Schedule the unblock to fire after the mock sets streamSessionResolve.
    // With the await fix, the controller awaits streamSession before sending
    // the HTTP response, so we must resolve it concurrently rather than after
    // the fetch returns.
    const unblockWhenReady = async () => {
      // Poll until the mock has registered its resolve handle, then call it.
      while (!streamSessionResolve) {
        await new Promise((r) => setTimeout(r, 5));
      }
      streamSessionResolve();
    };
    void unblockWhenReady();

    const res = await fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: 'claude-code',
        cwd: '/tmp',
        name: 'id-check',
      }),
    });

    await new Promise((r) => setTimeout(r, 20));

    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;

    // The local session id is a DB-generated UUID — it must not be the SDK UUID.
    expect(typeof body.id).toBe('string');
    expect(body.id).not.toBe('sdk-xxxx');
    // UUIDs are 36 chars: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
    expect((body.id as string).length).toBe(36);
  });
});
