/**
 * Acceptance contract for issue #1228.
 *
 * Regression caught: possession of another user's local caller-session id
 * authorizes synchronous or asynchronous delegation. The assertions that
 * fail are the HTTP 403 responses and the zero side-effect counts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createApp } from '../app';
import { getDb, setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { SessionsRepository } from '../repositories/sessions_repository';
import { UsersRepository } from '../repositories/users_repository';
import { startTestServer } from '../__tests__/helpers/real_server';

const { engineSpies, runSpy, sessionMap, streamSessionSpy } = vi.hoisted(() => ({
  engineSpies: {
    createSession: vi.fn(),
    promptAsync: vi.fn(),
  },
  runSpy: vi.fn(),
  sessionMap: new Map<string, string>(),
  streamSessionSpy: vi.fn(),
}));

vi.mock('../services/agent_runner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/agent_runner')>()),
  run: runSpy,
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: engineSpies,
  opencodeSessionMap: sessionMap,
}));

vi.mock('../services/opencode_stream_bridge', () => ({
  streamBridge: {
    streamSession: streamSessionSpy,
  },
}));

interface Actor {
  userId: number;
  headers: Record<string, string>;
}

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

function seedProfiles(): void {
  const profiles = new AgentConfigsRepository();
  profiles.insert({
    id: 'owner-manager',
    label: 'Owner manager',
    icon: 'agent',
    enabled: true,
    isAgent: true,
    isManager: true,
    sessionSelectable: true,
    allowedDelegatesJson: JSON.stringify(['owner-specialist']),
    corePermissionsJson: JSON.stringify({ rhythm_delegate_async: 'allow' }),
  });
  profiles.insert({
    id: 'owner-specialist',
    label: 'Owner specialist',
    icon: 'agent',
    enabled: true,
    isAgent: true,
    sessionSelectable: true,
    modelProvider: 'google',
    modelId: 'gemini-2.5-pro',
    ocAgent: 'owner-specialist',
  });
}

async function seedActor(name: string, email: string): Promise<Actor> {
  const user = new UsersRepository().create({ name, email });
  const session = await new SessionsRepository().createAsync(user.id);
  return {
    userId: user.id,
    headers: {
      Authorization: `Bearer ${session.token}`,
      'Content-Type': 'application/json',
    },
  };
}

function seedCaller(ownerUserId: number): string {
  const sessions = new AgentSessionsRepository();
  const caller = sessions.insert({
    agentKind: 'owner-manager' as never,
    taskId: null,
    cwd: '/tmp',
    name: `Manager for ${ownerUserId}`,
    mcpRole: 'owner-manager',
    ownerUserId,
  });
  sessions.setSdkSessionId(caller.id, `sdk-${caller.id}`);
  sessionMap.set(caller.id, `sdk-${caller.id}`);
  return caller.id;
}

function delegationBody(callerSessionId: string): Record<string, unknown> {
  return {
    callerSessionId,
    callerAgentConfigId: 'owner-manager',
    targetAgentConfigId: 'owner-specialist',
    prompt: 'Do the bounded specialist task.',
  };
}

describe('issue #1228 caller-session ownership', () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let owner: Actor;
  let attacker: Actor;
  let ownerCallerId: string;

  beforeEach(async () => {
    setDb(makeDb());
    seedProfiles();
    owner = await seedActor('Owner', 'owner-1228@example.com');
    attacker = await seedActor('Attacker', 'attacker-1228@example.com');
    ownerCallerId = seedCaller(owner.userId);

    vi.clearAllMocks();
    sessionMap.clear();
    sessionMap.set(ownerCallerId, `sdk-${ownerCallerId}`);
    runSpy.mockResolvedValue({
      sessionId: 'sync-child-1228',
      status: 'done',
      result: 'same-user result',
    });
    engineSpies.createSession.mockResolvedValue({ id: 'sdk-async-child-1228' });
    engineSpies.promptAsync.mockResolvedValue(true);
    streamSessionSpy.mockResolvedValue(undefined);

    ({ baseUrl, close: closeServer } = await startTestServer(createApp()));
  });

  afterEach(async () => {
    await closeServer();
  });

  async function post(
    path: '/delegate' | '/delegate-async',
    actor: Actor,
  ): Promise<Response> {
    return fetch(`${baseUrl}/agent-delegation${path}`, {
      method: 'POST',
      headers: actor.headers,
      body: JSON.stringify(delegationBody(ownerCallerId)),
    });
  }

  it('issue-1228-c1: sync and async delegation authenticate the caller-session owner', async () => {
    const syncDenied = await post('/delegate', attacker);
    const asyncDenied = await post('/delegate-async', attacker);

    expect(syncDenied.status).toBe(403);
    expect(asyncDenied.status).toBe(403);
  });

  it('issue-1228-c2: a known foreign caller-session id is denied', async () => {
    const response = await post('/delegate', attacker);

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: {
        code: 'FORBIDDEN',
        message: expect.stringMatching(/caller session.*another user|not owned/i),
      },
    });
  });

  it('issue-1228-c3: same-user sync and async delegation still succeed', async () => {
    const syncResponse = await post('/delegate', owner);
    const asyncResponse = await post('/delegate-async', owner);

    expect(syncResponse.status).toBe(200);
    expect(await syncResponse.json()).toMatchObject({
      sessionId: 'sync-child-1228',
      targetAgentConfigId: 'owner-specialist',
    });
    expect(asyncResponse.status).toBe(202);
    expect(await asyncResponse.json()).toMatchObject({
      status: 'dispatched',
      targetAgentConfigId: 'owner-specialist',
    });
  });

  it('issue-1228-c4: two-user HTTP denial creates no sync run or async delegation', async () => {
    expect((await post('/delegate', attacker)).status).toBe(403);
    expect((await post('/delegate-async', attacker)).status).toBe(403);

    expect(runSpy).not.toHaveBeenCalled();
    expect(engineSpies.createSession).not.toHaveBeenCalled();
    const asyncRows = getDb()
      .prepare('SELECT COUNT(*) AS count FROM agent_async_delegations')
      .get() as { count: number };
    expect(asyncRows.count).toBe(0);
  });
});
