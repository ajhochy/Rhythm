/**
 * Auto (router) model mode — session create / PATCH / migration contract.
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

vi.mock('../services/opencode_engine', () => {
  const mockClient = {
    isReady: true,
    listAuthedProviders: vi.fn().mockResolvedValue(['anthropic', 'openai']),
    statusMessage: 'Opencode SDK ready',
    createSession: vi.fn().mockResolvedValue({ id: 'sdk-session-1' }),
    setAuth: vi.fn().mockResolvedValue(true),
    prompt: vi.fn().mockResolvedValue({}),
    promptAsync: vi.fn().mockResolvedValue(true),
    subscribeToEvents: vi.fn().mockResolvedValue(null),
    ensureReady: vi.fn().mockResolvedValue(true),
    getSessionDiff: vi.fn().mockResolvedValue([]),
    abortSession: vi.fn().mockResolvedValue(true),
  };
  return { opencodeClient: mockClient, opencodeSessionMap: new Map<string, string>() };
});
vi.mock('../services/opencode_stream_bridge', () => ({
  streamBridge: {
    streamSession: vi.fn().mockResolvedValue(undefined),
    stopStream: vi.fn(),
    clearErrorStatus: vi.fn(),
    dispose: vi.fn(),
  },
}));

type SessionJson = { id: string; modelMode: string; providerId: string | null; modelId: string | null };

describe('Auto (router) model mode — sessions API', () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let headers: Record<string, string>;

  beforeEach(async () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);
    const user = new UsersRepository().create({ name: 'T', email: 't@example.com' });
    const session = await new SessionsRepository().createAsync(user.id);
    headers = { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' };
    ({ baseUrl, close: closeServer } = await startTestServer(createApp()));
  });
  afterEach(async () => {
    await closeServer();
    vi.clearAllMocks();
  });

  const post = (extra: Record<string, unknown> = {}) =>
    fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ agentId: 'claude-code', cwd: os.homedir(), name: 'S', ...extra }),
    });

  it("POST defaults modelMode to 'auto' and every payload carries it", async () => {
    const res = await post();
    expect(res.status).toBe(201);
    const s = (await res.json()) as SessionJson;
    expect(s.modelMode).toBe('auto');
    const got = (await (await fetch(`${baseUrl}/agent-sessions/${s.id}`, { headers })).json()) as {
      session?: SessionJson;
    } & SessionJson;
    expect((got.session ?? got).modelMode).toBe('auto');
    expect(new AgentSessionsRepository().findById(s.id)?.modelMode).toBe('auto');
  });

  it("POST honours explicit modelMode 'fixed'", async () => {
    const res = await post({ modelMode: 'fixed' });
    expect(res.status).toBe(201);
    expect(((await res.json()) as SessionJson).modelMode).toBe('fixed');
  });

  it('POST rejects an invalid modelMode with 400', async () => {
    for (const bad of ['router', '', 1, null, true]) {
      expect((await post({ modelMode: bad })).status).toBe(400);
    }
  });

  it('PATCH round-trips auto -> fixed(pin) -> auto keeping the stored model as fallback', async () => {
    const { id } = (await (await post()).json()) as SessionJson;
    const patch = async (body: Record<string, unknown>) => {
      const res = await fetch(`${baseUrl}/agent-sessions/${id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(body),
      });
      return { status: res.status, json: (await res.json()) as SessionJson };
    };
    const pinned = await patch({ modelMode: 'fixed', providerId: 'anthropic', modelId: 'claude-sonnet-4-6' });
    expect(pinned.status).toBe(200);
    expect(pinned.json).toMatchObject({ modelMode: 'fixed', providerId: 'anthropic', modelId: 'claude-sonnet-4-6' });
    const back = await patch({ modelMode: 'auto' });
    expect(back.json).toMatchObject({ modelMode: 'auto', providerId: 'anthropic', modelId: 'claude-sonnet-4-6' });
    expect((await patch({ modelMode: 'bogus' })).status).toBe(400);
  });

  it('repository: dto without modelMode inserts fixed; invalid values normalise to fixed', () => {
    const repo = new AgentSessionsRepository();
    const s = repo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: 'x' });
    expect(s.modelMode).toBe('fixed');
    const a = repo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: 'y', modelMode: 'auto' });
    expect(a.modelMode).toBe('auto');
    repo.updateFields(a.id, { modelMode: 'nope' as never });
    expect(repo.findById(a.id)?.modelMode).toBe('fixed');
  });
});

describe('model_mode migration', () => {
  it("adds the column with a 'fixed' default to a pre-existing agent_sessions table", () => {
    const db = new Database(':memory:');
    runMigrations(db);
    // Simulate a legacy DB: rebuild without the column, insert a row, migrate again.
    db.exec('ALTER TABLE agent_sessions DROP COLUMN model_mode');
    db.prepare(
      `INSERT INTO agent_sessions (id, agent_kind, status, cwd, name, created_at, updated_at)
       VALUES ('legacy', 'claude-code', 'idle', '/tmp', 'old', 'now', 'now')`,
    ).run();
    runMigrations(db);
    const row = db.prepare('SELECT model_mode FROM agent_sessions WHERE id = ?').get('legacy') as {
      model_mode: string;
    };
    expect(row.model_mode).toBe('fixed');
    const col = (db.pragma('table_info(agent_sessions)') as { name: string; dflt_value: string | null; notnull: number }[]).find(
      (c) => c.name === 'model_mode',
    );
    expect(col?.notnull).toBe(1);
    expect(col?.dflt_value).toBe("'fixed'");
  });
});
