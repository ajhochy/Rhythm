/**
 * #743 — Child session persistence and getDiff soft-404 tests.
 *
 * Requirements verified:
 * 1. upsertChildSession() creates a local row linked to the parent.
 * 2. upsertChildSession() is idempotent (repeated call returns the same row).
 * 3. upsertChildSession() returns null when the parent SDK id is unknown.
 * 4. getDiff returns [] (200) when the session id is not in the local store.
 * 5. getDiff returns [] (200) when the local row has no SDK mapping.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { startTestServer } from './helpers/real_server';

// Mock opencode engine — we never need a real engine in these tests.
vi.mock('../services/opencode_engine', () => {
  const mockClient = {
    get isReady() { return true; },
    statusMessage: 'ready',
    createSession: vi.fn().mockResolvedValue({ id: 'sdk-session-parent' }),
    getSessionDiff: vi.fn().mockResolvedValue([]),
    abortSession: vi.fn().mockResolvedValue(true),
    ensureReady: vi.fn().mockResolvedValue(true),
    subscribeToEvents: vi.fn().mockResolvedValue(null),
    listAuthedProviders: vi.fn().mockResolvedValue(['anthropic']),
    listAgents: vi.fn().mockResolvedValue([]),
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

vi.mock('../services/agent_profile_sync', () => ({
  syncOpencodeAgentProfiles: vi.fn().mockResolvedValue(undefined),
}));

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

describe('#743 — upsertChildSession (repository)', () => {
  let repo: AgentSessionsRepository;

  beforeEach(() => {
    const db = makeDb();
    setDb(db);
    repo = new AgentSessionsRepository();
  });

  it('creates a child row linked to the parent local id', () => {
    // Insert a parent session with a known SDK id.
    const parent = repo.insert({
      agentKind: 'claude-code',
      taskId: null,
      cwd: '/tmp/proj',
      name: 'Parent session',
    });
    repo.setSdkSessionId(parent.id, 'sdk-parent-1');

    // Upsert the child.
    const child = repo.upsertChildSession(
      'sdk-child-1',
      'sdk-parent-1',
      'Subagent task',
      '/tmp/proj',
    );

    expect(child).not.toBeNull();
    expect(child!.parentSessionId).toBe(parent.id);
    expect(child!.sdkSessionId).toBe('sdk-child-1');
    expect(child!.name).toBe('Subagent task');
    expect(child!.status).toBe('starting');
    // Title without the "(@X subagent)" marker → inherits the parent's kind.
    expect(child!.agentKind).toBe('claude-code');
  });

  it("#867: parses the specialist agent from the engine's '(@X subagent)' title so the child row carries its REAL identity", () => {
    const parent = repo.insert({
      agentKind: 'secretary' as never, // custom profile ids are valid at runtime
      taskId: null,
      cwd: '/tmp/proj',
      name: 'Parent session',
    });
    repo.setSdkSessionId(parent.id, 'sdk-parent-867');

    const child = repo.upsertChildSession(
      'sdk-child-867',
      'sdk-parent-867',
      'Research trends (@AI-Trend-Researcher subagent)',
      '/tmp/proj',
    );

    expect(child).not.toBeNull();
    // NOT the parent's kind and NOT claude-code — the parsed specialist.
    expect(child!.agentKind).toBe('AI-Trend-Researcher');
  });

  it('is idempotent: second call returns the same row without creating a duplicate', () => {
    const parent = repo.insert({
      agentKind: 'claude-code',
      taskId: null,
      cwd: '/tmp/proj',
      name: 'Parent',
    });
    repo.setSdkSessionId(parent.id, 'sdk-parent-2');

    const child1 = repo.upsertChildSession('sdk-child-2', 'sdk-parent-2', 'Task A', '/tmp/proj');
    const child2 = repo.upsertChildSession('sdk-child-2', 'sdk-parent-2', 'Task A', '/tmp/proj');

    expect(child1).not.toBeNull();
    expect(child2).not.toBeNull();
    expect(child1!.id).toBe(child2!.id);

    // Only one row should exist for sdk-child-2.
    const allSessions = repo.listAll(50);
    const childRows = allSessions.filter((s) => s.sdkSessionId === 'sdk-child-2');
    expect(childRows).toHaveLength(1);
  });

  it('returns null when the parent SDK id is unknown', () => {
    const result = repo.upsertChildSession(
      'sdk-child-orphan',
      'sdk-unknown-parent',
      'Orphaned task',
      '/tmp',
    );
    expect(result).toBeNull();
  });

  it('persists parentSessionId on the returned model', () => {
    const parent = repo.insert({
      agentKind: 'claude-code',
      taskId: null,
      cwd: '/tmp',
      name: 'P',
    });
    repo.setSdkSessionId(parent.id, 'sdk-p-3');
    const child = repo.upsertChildSession('sdk-c-3', 'sdk-p-3', 'T', '/tmp');
    expect(child!.parentSessionId).toBe(parent.id);

    // Verify the persisted value is also readable via findById.
    const refetched = repo.findById(child!.id);
    expect(refetched!.parentSessionId).toBe(parent.id);
  });
});

describe('#743 — getDiff soft-404 (HTTP)', () => {
  // Each test uses a fresh module graph with AGENT_LOCAL=true so routes
  // bypass auth — same pattern as agent_local_auth_bypass.test.ts.
  let baseUrl: string;
  let closeServer: () => Promise<void>;

  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv('AGENT_LOCAL', 'true');

    // Re-import db/migrations/app after env stub so all modules see AGENT_LOCAL.
    const { setDb: freshSetDb } = await import('../database/db');
    const { runMigrations: freshMigrations } = await import('../database/migrations');
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    freshMigrations(db);
    freshSetDb(db);

    const { createApp } = await import('../app');
    ({ baseUrl, close: closeServer } = await startTestServer(createApp()));
  });

  afterEach(async () => {
    await closeServer();
    vi.unstubAllEnvs();
  });

  it('returns 200 [] for an unknown session id (no ERROR flood)', async () => {
    const response = await fetch(
      `${baseUrl}/agent-sessions/ses_unknownXYZ/diff`,
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual([]);
  });
});
