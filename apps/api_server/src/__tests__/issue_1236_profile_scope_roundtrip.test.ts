import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { createApp } from '../app';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { startTestServer } from './helpers/real_server';
import { UsersRepository } from '../repositories/users_repository';
import { SessionsRepository } from '../repositories/sessions_repository';

describe('issue-1236-c7: PATCH and GET round-trip array and object scope shapes', () => {
  let baseUrl = '';
  let closeServer: () => Promise<void>;
  let authHeaders: Record<string, string> = {};

  beforeAll(async () => {
    const db = new Database(':memory:');
    runMigrations(db);
    setDb(db);
    const user = new UsersRepository().create({ name: 'Scope Tester', email: 'scope@test.local' });
    const session = await new SessionsRepository().createAsync(user.id);
    authHeaders = { Authorization: `Bearer ${session.token}` };
    ({ baseUrl, close: closeServer } = await startTestServer(createApp()));
  });

  afterAll(async () => closeServer());

  it('persists granular MCP tools and skill names without shape loss', async () => {
    const created = await fetch(`${baseUrl}/agent-configs`, {
      method: 'POST',
      headers: {...authHeaders, 'content-type': 'application/json'},
      body: JSON.stringify({id: 'scope-roundtrip', label: 'Scope Roundtrip'}),
    });
    expect(created.status).toBe(201);

    const allowedMcpsJson = JSON.stringify({
      rhythm: ['list_tasks', 'create_task'],
      'pco-services': [],
    });
    const allowedSkillsJson = JSON.stringify(['sermon-research']);
    const patched = await fetch(`${baseUrl}/agent-configs/scope-roundtrip`, {
      method: 'PATCH',
      headers: {...authHeaders, 'content-type': 'application/json'},
      body: JSON.stringify({allowedMcpsJson, allowedSkillsJson}),
    });
    expect(patched.status).toBe(200);

    const fetched = await fetch(`${baseUrl}/agent-configs/scope-roundtrip`, { headers: authHeaders });
    expect(fetched.status).toBe(200);
    const profile = await fetched.json() as {
      allowedMcpsJson: string;
      allowedSkillsJson: string;
    };
    expect(JSON.parse(profile.allowedMcpsJson)).toEqual({
      rhythm: ['list_tasks', 'create_task'],
      'pco-services': [],
    });
    expect(JSON.parse(profile.allowedSkillsJson)).toEqual(['sermon-research']);
  });
});
