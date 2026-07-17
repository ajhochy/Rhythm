/**
 * #1048 (OCU-07) — Delete engine sessions on hard delete.
 *
 * Contract: hard-deleting a Rhythm session (DELETE /agent-sessions/:id/hard)
 * must also delete the engine-side session so messages/parts/snapshots don't
 * leak forever. Engine delete is recursive over children, so exactly one engine
 * call cleans the whole tree. It must be 404-tolerant (already-gone engine
 * session still yields a successful hard delete), and the soft-delete/close
 * path (DELETE /agent-sessions/:id → remove) must NOT touch the engine.
 *
 * These assertions are at the boundary: the engine SDK is mocked (that is the
 * thing OUTSIDE the unit); the controller wiring under test is real. The live
 * end-to-end 404 assertion runs separately against the sandbox (see run log).
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'os';
import Database from 'better-sqlite3';
import { createApp } from '../app';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { startTestServer } from './helpers/real_server';
import { UsersRepository } from '../repositories/users_repository';
import { SessionsRepository } from '../repositories/sessions_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';

// Mock the engine. deleteSession is the wrapper under contract; it mirrors the
// real service (404-tolerant → resolves true). We assert call count + args.
vi.mock('../services/opencode_engine', () => {
  const mockClient = {
    get isReady() { return true; },
    statusMessage: 'Opencode SDK ready',
    listAuthedProviders: vi.fn().mockResolvedValue(['anthropic']),
    createSession: vi.fn().mockResolvedValue({ id: 'sdk-session-1' }),
    getSessionDiff: vi.fn().mockResolvedValue([]),
    abortSession: vi.fn().mockResolvedValue(true),
    deleteSession: vi.fn().mockResolvedValue(true),
    ensureReady: vi.fn().mockResolvedValue(true),
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
    clearErrorStatus: vi.fn(),
    dispose: vi.fn(),
  },
}));

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

describe('#1048 — engine session delete on hard delete', () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let authHeaders: Record<string, string>;

  beforeEach(async () => {
    setDb(makeDb());
    const usersRepo = new UsersRepository();
    const sessionsRepo = new SessionsRepository();
    const user = usersRepo.create({ name: 'Test User', email: 'test@example.com' });
    const session = await sessionsRepo.createAsync(user.id);
    authHeaders = {
      Authorization: `Bearer ${session.token}`,
      'Content-Type': 'application/json',
    };
    ({ baseUrl, close: closeServer } = await startTestServer(createApp()));
  });

  afterEach(async () => {
    await closeServer();
    vi.clearAllMocks();
  });

  /** Insert a session row with a persisted SDK session id and return it. */
  function seedSessionWithSdkId(sdkId: string): string {
    const repo = new AgentSessionsRepository();
    const row = repo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: os.homedir(),
      name: 'To Delete',
    });
    repo.setSdkSessionId(row.id, sdkId);
    return row.id;
  }

  it('hard delete calls engine deleteSession once with the SDK id, then removes the row', async () => {
    const localId = seedSessionWithSdkId('sdk-hard-del-1');
    const { opencodeClient } = await import('../services/opencode_engine');
    const del = (opencodeClient as unknown as { deleteSession: ReturnType<typeof vi.fn> }).deleteSession;

    const res = await fetch(`${baseUrl}/agent-sessions/${localId}/hard`, {
      method: 'DELETE',
      headers: authHeaders,
    });

    expect(res.status).toBe(204);
    // Engine recurses over children → exactly one engine call for the tree.
    expect(del).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledWith('sdk-hard-del-1', expect.any(String));
    // Local row is gone.
    expect(new AgentSessionsRepository().findById(localId)).toBeNull();
  });

  it('hard delete still succeeds (204) when the engine session is already gone (404-tolerant)', async () => {
    const localId = seedSessionWithSdkId('sdk-gone-1');
    const { opencodeClient } = await import('../services/opencode_engine');
    const del = (opencodeClient as unknown as { deleteSession: ReturnType<typeof vi.fn> }).deleteSession;
    // Real wrapper tolerates 404 by resolving true; simulate that here.
    del.mockResolvedValueOnce(true);

    const res = await fetch(`${baseUrl}/agent-sessions/${localId}/hard`, {
      method: 'DELETE',
      headers: authHeaders,
    });

    expect(res.status).toBe(204);
    expect(del).toHaveBeenCalledTimes(1);
    expect(new AgentSessionsRepository().findById(localId)).toBeNull();
  });

  it('hard delete completes even if the engine delete throws (best-effort, local row still removed)', async () => {
    const localId = seedSessionWithSdkId('sdk-throw-1');
    const { opencodeClient } = await import('../services/opencode_engine');
    const del = (opencodeClient as unknown as { deleteSession: ReturnType<typeof vi.fn> }).deleteSession;
    del.mockRejectedValueOnce(new Error('engine transport blew up'));

    const res = await fetch(`${baseUrl}/agent-sessions/${localId}/hard`, {
      method: 'DELETE',
      headers: authHeaders,
    });

    expect(res.status).toBe(204);
    expect(del).toHaveBeenCalledTimes(1);
    expect(new AgentSessionsRepository().findById(localId)).toBeNull();
  });

  it('soft delete (DELETE /:id → close) does NOT call engine deleteSession', async () => {
    const localId = seedSessionWithSdkId('sdk-soft-1');
    const { opencodeClient } = await import('../services/opencode_engine');
    const del = (opencodeClient as unknown as { deleteSession: ReturnType<typeof vi.fn> }).deleteSession;

    const res = await fetch(`${baseUrl}/agent-sessions/${localId}`, {
      method: 'DELETE',
      headers: authHeaders,
    });

    expect(res.status).toBe(204);
    expect(del).not.toHaveBeenCalled();
    // Row is retained (status flipped to closed, not deleted).
    expect(new AgentSessionsRepository().findById(localId)).not.toBeNull();
  });
});
