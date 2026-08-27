/**
 * background_status.test.ts — #747
 *
 * Tests for:
 *  1. GET /agent-sessions/background-status — endpoint shape validation
 *  2. System session exclusion from the normal session list
 *  3. is_system column migration is applied by runMigrations
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'os';
import Database from 'better-sqlite3';
import { createApp } from '../app';
import { runMigrations } from '../database/migrations';
import { setDb, getDb } from '../database/db';
import { startTestServer } from './helpers/real_server';
import { UsersRepository } from '../repositories/users_repository';
import { SessionsRepository } from '../repositories/sessions_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';

// Mock the Opencode engine — we test the route/controller layer, not the engine.
vi.mock('../services/opencode_engine', () => {
  const mockClient = {
    isReady: true,
    listAuthedProviders: vi.fn().mockResolvedValue(['anthropic']),
    statusMessage: 'Opencode SDK ready',
    createSession: vi.fn().mockResolvedValue({ id: 'sdk-session-1' }),
    setAuth: vi.fn().mockResolvedValue(true),
    prompt: vi.fn().mockResolvedValue({}),
    promptAsync: vi.fn().mockResolvedValue(true),
    subscribeToEvents: vi.fn().mockResolvedValue(null),
    ensureReady: vi.fn().mockResolvedValue(true),
    getSessionDiff: vi.fn().mockResolvedValue([]),
    abortSession: vi.fn().mockResolvedValue(true),
    listAgents: vi.fn().mockResolvedValue([]),
    listCommands: vi.fn().mockResolvedValue([]),
    listMessages: vi.fn().mockResolvedValue([]),
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

// Mock skill_extractor and skill_refiner status exports so the controller
// can call them without real LLM state.
vi.mock('../services/skill_extractor', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../services/skill_extractor')>();
  return {
    ...mod,
    getCuratorExtractStatus: vi.fn().mockReturnValue({ running: false, lastRunAt: null }),
  };
});

vi.mock('../services/skill_refiner', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../services/skill_refiner')>();
  return {
    ...mod,
    getCuratorRefineStatus: vi.fn().mockReturnValue({ running: false, lastRunAt: '2026-06-25T10:00:00.000Z' }),
  };
});

vi.mock('../services/sync_orchestrator_service', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../services/sync_orchestrator_service')>();
  return {
    ...mod,
    getSyncStatus: vi.fn().mockReturnValue({ running: true, lastRunAt: '2026-06-25T12:00:00.000Z' }),
  };
});

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

describe('#747 — Background activity indicator', () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let authHeaders: Record<string, string>;
  let agentSessionsRepo: AgentSessionsRepository;

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

    agentSessionsRepo = new AgentSessionsRepository();

    ({ baseUrl, close: closeServer } = await startTestServer(createApp()));
  });

  afterEach(async () => {
    await closeServer();
    vi.clearAllMocks();
  });

  // ── 1. background-status endpoint shape ─────────────────────────────────────

  describe('GET /agent-sessions/background-status', () => {
    it('returns 200 with expected shape', async () => {
      const res = await fetch(`${baseUrl}/agent-sessions/background-status`, {
        headers: authHeaders,
      });
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        loops: Array<{
          name: string;
          state: string;
          lastRunAt: string | null;
          nextRunAt: string | null;
        }>;
        activeCount: number;
        curator: { state: string; lastRunAt: string | null };
      };

      // Shape: loops array with 5 entries.
      expect(Array.isArray(body.loops)).toBe(true);
      expect(body.loops).toHaveLength(5);

      const names = body.loops.map((l) => l.name);
      expect(names).toContain('skill_harvester');
      expect(names).toContain('skill_improver');
      expect(names).toContain('memory');
      expect(names).toContain('scheduler');
      expect(names).toContain('integrations_sync');

      // Each loop has required fields.
      for (const loop of body.loops) {
        expect(['idle', 'running']).toContain(loop.state);
        expect('lastRunAt' in loop).toBe(true);
        expect('nextRunAt' in loop).toBe(true);
      }

      // activeCount is a number.
      expect(typeof body.activeCount).toBe('number');

      // curator aggregate is present.
      expect(body.curator).toBeDefined();
      expect(['idle', 'running']).toContain(body.curator.state);
    });

    it('reflects running state from mocked status functions', async () => {
      const res = await fetch(`${baseUrl}/agent-sessions/background-status`, {
        headers: authHeaders,
      });
      const body = (await res.json()) as {
        loops: Array<{ name: string; state: string }>;
        activeCount: number;
      };

      // sync_orchestrator_service mock returns running=true.
      const syncLoop = body.loops.find((l) => l.name === 'integrations_sync');
      expect(syncLoop?.state).toBe('running');

      // skill_extractor mock returns running=false.
      const harvesterLoop = body.loops.find((l) => l.name === 'skill_harvester');
      expect(harvesterLoop?.state).toBe('idle');

      // activeCount should reflect the running sync loop (at minimum 1).
      expect(body.activeCount).toBeGreaterThanOrEqual(1);
    });

    it('includes lastRunAt from skill_refiner mock', async () => {
      const res = await fetch(`${baseUrl}/agent-sessions/background-status`, {
        headers: authHeaders,
      });
      const body = (await res.json()) as {
        loops: Array<{ name: string; lastRunAt: string | null }>;
        curator: { lastRunAt: string | null };
      };

      // skill_refiner mock returns lastRunAt = '2026-06-25T10:00:00.000Z'.
      const improverLoop = body.loops.find((l) => l.name === 'skill_improver');
      expect(improverLoop?.lastRunAt).toBe('2026-06-25T10:00:00.000Z');

      // curator aggregate picks up the most recent of extract/refine lastRunAt.
      expect(body.curator.lastRunAt).toBe('2026-06-25T10:00:00.000Z');
    });
  });

  // ── 2. System session exclusion ──────────────────────────────────────────────

  describe('System session exclusion from session list', () => {
    it('is_system column exists after migration', () => {
      const cols = (getDb().pragma('table_info(agent_sessions)') as { name: string }[]).map(
        (c) => c.name,
      );
      expect(cols).toContain('is_system');
    });

    it('inserts a system session with is_system=1', () => {
      const session = agentSessionsRepo.insert({
        agentKind: 'claude-code',
        taskId: null,
        cwd: os.homedir(),
        name: 'skill-extract run',
        isSystem: true,
      });
      expect(session.isSystem).toBe(true);
    });

    it('inserts a normal session with is_system=0 by default', () => {
      const session = agentSessionsRepo.insert({
        agentKind: 'claude-code',
        taskId: null,
        cwd: os.homedir(),
        name: 'User chat',
      });
      expect(session.isSystem).toBe(false);
    });

    it('excludes is_system sessions from listAll()', () => {
      // Insert one normal and one system session.
      agentSessionsRepo.insert({
        agentKind: 'claude-code',
        taskId: null,
        cwd: os.homedir(),
        name: 'User chat',
        isSystem: false,
      });
      agentSessionsRepo.insert({
        agentKind: 'claude-code',
        taskId: null,
        cwd: os.homedir(),
        name: 'skill-extract run',
        isSystem: true,
      });

      const all = agentSessionsRepo.listAll();
      expect(all.every((s) => !s.isSystem)).toBe(true);
      expect(all.some((s) => s.name === 'User chat')).toBe(true);
      expect(all.some((s) => s.name === 'skill-extract run')).toBe(false);
    });

    it('excludes is_system sessions from listByProject()', () => {
      agentSessionsRepo.insert({
        agentKind: 'claude-code',
        taskId: null,
        cwd: os.homedir(),
        name: 'User session',
        isSystem: false,
      });
      agentSessionsRepo.insert({
        agentKind: 'claude-code',
        taskId: null,
        cwd: os.homedir(),
        name: 'Memory Consolidation run',
        isSystem: true,
      });

      const results = agentSessionsRepo.listByProject(null);
      expect(results.every((s) => !s.isSystem)).toBe(true);
      expect(results.some((s) => s.name === 'User session')).toBe(true);
      expect(results.some((s) => s.name === 'Memory Consolidation run')).toBe(false);
    });

    it('GET /agent-sessions list excludes is_system sessions', async () => {
      // Insert one user-facing and one system session via the repo directly
      // (bypassing the API since the create endpoint doesn't accept is_system).
      agentSessionsRepo.insert({
        agentKind: 'claude-code',
        taskId: null,
        cwd: os.homedir(),
        name: 'Normal chat session',
        isSystem: false,
      });
      agentSessionsRepo.insert({
        agentKind: 'claude-code',
        taskId: null,
        cwd: os.homedir(),
        name: 'skill-refine-judge run',
        isSystem: true,
      });

      const res = await fetch(`${baseUrl}/agent-sessions`, { headers: authHeaders });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { sessions: Array<{ name: string; isSystem: boolean }> };

      expect(body.sessions.some((s) => s.name === 'Normal chat session')).toBe(true);
      expect(body.sessions.some((s) => s.name === 'skill-refine-judge run')).toBe(false);
    });

    it('findById returns system sessions directly (for internal use)', () => {
      const inserted = agentSessionsRepo.insert({
        agentKind: 'claude-code',
        taskId: null,
        cwd: os.homedir(),
        name: 'skill-extract run',
        isSystem: true,
      });
      const found = agentSessionsRepo.findById(inserted.id);
      expect(found).not.toBeNull();
      expect(found?.isSystem).toBe(true);
    });

    it('child sessions (parent_session_id NOT NULL) are not treated as is_system', () => {
      // Insert parent.
      const parent = agentSessionsRepo.insert({
        agentKind: 'claude-code',
        taskId: null,
        cwd: os.homedir(),
        name: 'Parent session',
        isSystem: false,
      });
      agentSessionsRepo.setSdkSessionId(parent.id, 'sdk-parent-1');

      // Upsert a child (simulates #743 stream bridge path).
      const child = agentSessionsRepo.upsertChildSession(
        'sdk-child-1',
        'sdk-parent-1',
        'Subagent task',
        os.homedir(),
      );
      expect(child).not.toBeNull();
      expect(child?.isSystem).toBe(false);

      // Child appears in listAll.
      const all = agentSessionsRepo.listAll();
      const listedParent = all.find((s) => s.id === parent.id);
      expect(listedParent?.children?.some((s) => s.id === child!.id)).toBe(true);
    });
  });

  // ── 3. AgentConfigsController exclusion (via /agent-sessions/agents) ─────────
  // The agent picker calls GET /agent-sessions/agents — that route uses
  // opencodeClient.listAgents(), which is mocked. The is_system exclusion on
  // the session list is the primary control; no separate picker filter needed
  // because the picker does not use the session list.

  it('background-status route is registered before /:id wildcard', async () => {
    // If background-status were treated as an id lookup it would hit findById
    // and return 404. A 200 response confirms the static route wins.
    const res = await fetch(`${baseUrl}/agent-sessions/background-status`, {
      headers: authHeaders,
    });
    expect(res.status).toBe(200);
  });
});
