/**
 * #1072 (OCU-31) — org-settings route contract tests.
 *
 * Mirrors org_skills_routes.test.ts's auth-posture coverage:
 *  - GET /org-settings/instructions is PUBLIC and 404s when never set.
 *  - PUT /org-settings/instructions requires auth and round-trips content.
 *  - A PUT overwrites the singleton row (not append) — the next GET returns
 *    the latest content only.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { createApp } from '../app';
import { UsersRepository } from '../repositories/users_repository';
import { SessionsRepository } from '../repositories/sessions_repository';
import { startTestServer } from './helpers/real_server';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

describe('org-settings routes (#1072)', () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let authHeaders: Record<string, string>;

  beforeEach(async () => {
    const db = makeDb();
    setDb(db);
    const user = new UsersRepository().create({ name: 'T', email: 't@example.com' });
    const session = await new SessionsRepository().createAsync(user.id);
    authHeaders = { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' };

    const { baseUrl: b, close } = await startTestServer(createApp());
    baseUrl = b;
    closeServer = close;
  });

  afterEach(async () => {
    await closeServer();
  });

  it('GET /org-settings/instructions 404s when nothing has been set yet', async () => {
    const res = await fetch(`${baseUrl}/org-settings/instructions`);
    expect(res.status).toBe(404);
  });

  it('GET /org-settings/instructions requires no auth (public read)', async () => {
    await fetch(`${baseUrl}/org-settings/instructions`, {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({ content: '# Org policy\n\nBe kind.' }),
    });
    const res = await fetch(`${baseUrl}/org-settings/instructions`); // no Authorization header
    expect(res.status).toBe(200);
    const body = (await res.json()) as { content: string; updatedAt: string };
    expect(body.content).toBe('# Org policy\n\nBe kind.');
    expect(typeof body.updatedAt).toBe('string');
  });

  it('PUT /org-settings/instructions rejects unauthenticated requests', async () => {
    const res = await fetch(`${baseUrl}/org-settings/instructions`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'x' }),
    });
    expect(res.status).toBe(401);
  });

  it('PUT rejects an empty content string', async () => {
    const res = await fetch(`${baseUrl}/org-settings/instructions`, {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({ content: '   ' }),
    });
    expect(res.status).toBe(400);
  });

  it('a second PUT overwrites the singleton row — GET returns only the latest content', async () => {
    await fetch(`${baseUrl}/org-settings/instructions`, {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({ content: 'first version' }),
    });
    await fetch(`${baseUrl}/org-settings/instructions`, {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({ content: 'second version' }),
    });
    const res = await fetch(`${baseUrl}/org-settings/instructions`);
    const body = (await res.json()) as { content: string };
    expect(body.content).toBe('second version');
  });
});
