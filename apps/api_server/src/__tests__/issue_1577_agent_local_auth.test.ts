import { afterEach, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { startTestServer } from './helpers/real_server';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it('issue-1577-c2: AGENT_LOCAL leaves GET session public but refuses tokenless prompt and prompt-log', async () => {
  vi.stubEnv('AGENT_LOCAL', 'true');
  vi.resetModules();
  const [{ createApp }, { runMigrations }, { setDb }, { AgentSessionsRepository }] = await Promise.all([
    import('../app'), import('../database/migrations'), import('../database/db'),
    import('../repositories/agent_sessions_repository'),
  ]);
  const db = new Database(':memory:');
  runMigrations(db);
  setDb(db);
  const session = new AgentSessionsRepository().insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: 'Public read', ownerUserId: null });
  const { baseUrl, close } = await startTestServer(createApp());
  try {
    expect((await fetch(`${baseUrl}/agent-sessions/${session.id}`)).status).toBe(200);
    expect((await fetch(`${baseUrl}/agent-sessions/${session.id}/prompt`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'unauthenticated' }),
    })).status).toBe(401);
    expect((await fetch(`${baseUrl}/agent-sessions/${session.id}/prompt-log`)).status).toBe(401);
  } finally {
    await close();
    db.close();
  }
});
