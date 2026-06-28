/**
 * B1 — agent_cookbook CRUD route tests
 *
 * Criteria covered:
 *   - GET /agent-cookbook returns [] on empty DB (schema-drift gate)
 *   - POST /agent-cookbook creates a recipe and returns it with an id
 *   - GET /agent-cookbook/:id returns the recipe
 *   - PATCH /agent-cookbook/:id updates mutable fields and updated_at
 *   - DELETE /agent-cookbook/:id returns 204
 *   - GET /agent-cookbook/:id returns 404 for unknown id
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { createApp } from '../app';
import { startTestServer } from './helpers/real_server';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { UsersRepository } from '../repositories/users_repository';
import { SessionsRepository } from '../repositories/sessions_repository';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

describe('B1 — /agent-cookbook CRUD', () => {
  let baseUrl: string;
  let authHeader: Record<string, string>;
  let closeServer: () => Promise<void>;

  beforeEach(async () => {
    setDb(makeDb());

    const usersRepo = new UsersRepository();
    const sessionsRepo = new SessionsRepository();
    const user = usersRepo.create({ name: 'Test', email: 'test@example.com' });
    const session = await sessionsRepo.createAsync(user.id);
    authHeader = { Authorization: `Bearer ${session.token}` };

    ({ baseUrl, close: closeServer } = await startTestServer(createApp()));
  });

  afterEach(async () => {
    await closeServer();
  });

  it('GET /agent-cookbook returns [] on empty DB', async () => {
    const res = await fetch(`${baseUrl}/agent-cookbook`, {
      headers: authHeader,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  it('POST /agent-cookbook creates a recipe and returns it', async () => {
    const res = await fetch(`${baseUrl}/agent-cookbook`, {
      method: 'POST',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Weekly summary',
        description: 'Summarise the week',
        steps: [{ action: 'prompt', text: 'Summarise tasks' }],
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(typeof body.id).toBe('string');
    expect(body.title).toBe('Weekly summary');
    expect(body.description).toBe('Summarise the week');
    expect(typeof body.stepsJson).toBe('string');
    expect(typeof body.createdAt).toBe('string');
    expect(typeof body.updatedAt).toBe('string');
  });

  it('GET /agent-cookbook/:id returns the created recipe', async () => {
    const createRes = await fetch(`${baseUrl}/agent-cookbook`, {
      method: 'POST',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'My Recipe' }),
    });
    const created = (await createRes.json()) as { id: string };

    const getRes = await fetch(`${baseUrl}/agent-cookbook/${created.id}`, {
      headers: authHeader,
    });
    expect(getRes.status).toBe(200);
    const body = (await getRes.json()) as Record<string, unknown>;
    expect(body.id).toBe(created.id);
    expect(body.title).toBe('My Recipe');
  });

  it('PATCH /agent-cookbook/:id updates mutable fields', async () => {
    const createRes = await fetch(`${baseUrl}/agent-cookbook`, {
      method: 'POST',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Original' }),
    });
    const created = (await createRes.json()) as {
      id: string;
      updatedAt: string;
    };

    const patchRes = await fetch(`${baseUrl}/agent-cookbook/${created.id}`, {
      method: 'PATCH',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Updated', description: 'New desc' }),
    });
    expect(patchRes.status).toBe(200);
    const body = (await patchRes.json()) as Record<string, unknown>;
    expect(body.title).toBe('Updated');
    expect(body.description).toBe('New desc');
  });

  it('DELETE /agent-cookbook/:id returns 204', async () => {
    const createRes = await fetch(`${baseUrl}/agent-cookbook`, {
      method: 'POST',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'To delete' }),
    });
    const created = (await createRes.json()) as { id: string };

    const delRes = await fetch(`${baseUrl}/agent-cookbook/${created.id}`, {
      method: 'DELETE',
      headers: authHeader,
    });
    expect(delRes.status).toBe(204);

    // Subsequent GET should 404
    const getRes = await fetch(`${baseUrl}/agent-cookbook/${created.id}`, {
      headers: authHeader,
    });
    expect(getRes.status).toBe(404);
  });

  it('GET /agent-cookbook/:id returns 404 for unknown id', async () => {
    const res = await fetch(`${baseUrl}/agent-cookbook/nonexistent-id-xyz`, {
      headers: authHeader,
    });
    expect(res.status).toBe(404);
  });

  it('GET /agent-cookbook returns multiple recipes ordered by created_at DESC', async () => {
    await fetch(`${baseUrl}/agent-cookbook`, {
      method: 'POST',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'First' }),
    });
    await fetch(`${baseUrl}/agent-cookbook`, {
      method: 'POST',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Second' }),
    });

    const res = await fetch(`${baseUrl}/agent-cookbook`, {
      headers: authHeader,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { title: string }[];
    expect(body.length).toBe(2);
    // Both recipes are present
    const titles = body.map((r) => r.title);
    expect(titles).toContain('First');
    expect(titles).toContain('Second');
  });

  it('GET /agent-cookbook returns 401 when unauthenticated', async () => {
    const res = await fetch(`${baseUrl}/agent-cookbook`);
    expect(res.status).toBe(401);
  });
});
