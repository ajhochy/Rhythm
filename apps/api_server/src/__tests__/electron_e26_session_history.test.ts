import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { createApp } from '../app';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { startTestServer } from './helpers/real_server';
import { UsersRepository } from '../repositories/users_repository';
import { SessionsRepository } from '../repositories/sessions_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { env } from '../config/env';

describe('E26 real controller + SQLite HTTP contract', () => {
  let db: Database.Database;
  let baseUrl: string;
  let close: () => Promise<void>;
  let headers: Record<string, string>;
  let ownId: string;
  let ownChildId: string;
  let foreignId: string;
  beforeAll(async () => {
    db = new Database(':memory:');
    runMigrations(db);
    setDb(db);
    const users = new UsersRepository();
    const owner = users.create({ name: 'E26 owner', email: 'e26-owner@example.test' });
    const other = users.create({ name: 'E26 other', email: 'e26-other@example.test' });
    const auth = await new SessionsRepository().createAsync(owner.id);
    headers = { Authorization: `Bearer ${auth.token}` };
    const repo = new AgentSessionsRepository();
    for (let i = 0; i < 105; i++) repo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp/e26', name: `E26 history ${i}`, ownerUserId: owner.id });
    ownId = repo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp/e26', name: 'E26 parent', ownerUserId: owner.id }).id;
    ownChildId = repo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp/e26', name: 'E26 child needle', parentSessionId: ownId, ownerUserId: owner.id }).id;
    repo.updateStatus(ownChildId, 'working');
    foreignId = repo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp/e26', name: 'E26 foreign needle', ownerUserId: other.id }).id;
    repo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp/e26', name: 'E26 hidden child needle', parentSessionId: foreignId, ownerUserId: other.id });
    ({ baseUrl, close } = await startTestServer(createApp()));
  });
  afterAll(async () => { await close?.(); db?.close(); });
  const get = (query = '') => fetch(`${baseUrl}/agent-sessions${query}`, { headers });

  it('E26-c1/c6: opt-in bounded pages, legacy exact response shape', async () => {
    const legacy = await (await get()).json() as any;
    expect(Object.keys(legacy).sort()).toEqual(['resumable', 'sessions']);
    expect(legacy.sessions).toHaveLength(100);
    const first = await (await get('?limit=2')).json() as any;
    expect(first.sessions).toHaveLength(2);
    expect(first.pageInfo).toMatchObject({ limit: 2, hasMore: true });
    const second = await (await get(`?limit=2&cursor=${encodeURIComponent(first.pageInfo.nextCursor)}`)).json() as any;
    expect(new Set([...first.sessions, ...second.sessions].map(s => s.id)).size).toBe(4);
  });
  it('E26-c3/c5/c8: search and child query share auth and return needed ancestor context only', async () => {
    const result = await (await get('?search=%20NEEDLE%20')).json() as any;
    expect(result.sessions.map((s: any) => s.name)).toEqual(['E26 child needle']);
    expect(result.ancestors).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: ownId, hasChildren: true, childCount: 1, runningChildCount: 1 }),
    ]));
    const children = await (await get(`?parentId=${ownId}&limit=1`)).json() as any;
    expect(children.sessions.map((s: any) => s.name)).toEqual(['E26 child needle']);
    expect(children.sessions[0]).toMatchObject({ hasChildren: false, childCount: 0, runningChildCount: 0 });
    expect(children.pageInfo).toMatchObject({ hasMore: false, nextCursor: null });
    expect((await get(`?parentId=${foreignId}&limit=1`)).status).toBe(404);
    expect((await fetch(`${baseUrl}/agent-sessions?limit=1`)).status).toBe(401);
  });
  it('E26-c7: HTTP invalid query matrix returns bounded 400 rather than ignoring input', async () => {
    for (const query of ['limit=0', 'limit=101', 'limit=-1', 'limit=1.5', 'limit=', 'limit=abc', 'limit=1&limit=2', 'cursor=bad', 'cursor=', 'search[x]=bad', 'parentId=', 'scope=bad&limit=1']) {
      const response = await get(`?${query}`);
      const text = await response.text();
      expect(response.status, query).toBe(400);
      expect(text.length).toBeLessThan(500);
    }
  });
  it('E26-c8: deployment execution gate still removes the entire route', async () => {
    const enabled = env.agentExecutionEnabled;
    env.agentExecutionEnabled = false;
    let disabled: Awaited<ReturnType<typeof startTestServer>> | undefined;
    try {
      disabled = await startTestServer(createApp());
      for (const query of ['limit=1', `parentId=${ownId}`, 'search=needle']) {
        const response = await fetch(`${disabled.baseUrl}/agent-sessions?${query}`, { headers });
        await response.text();
        expect(response.status).toBe(404);
      }
    } finally {
      env.agentExecutionEnabled = enabled;
      await disabled?.close();
    }
  });
});
