import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { createApp } from '../app';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { UsersRepository } from '../repositories/users_repository';
import { SessionsRepository } from '../repositories/sessions_repository';
import type { AddressInfo } from 'node:net';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

function makeServer() {
  const server = createApp().listen(0);
  // Close each connection after a single request so the response carries
  // `Connection: close` — keeps undici from reusing a stale pooled socket when
  // a later test's `listen(0)` recycles the same ephemeral port.
  server.maxRequestsPerSocket = 1;
  return server;
}

async function setup() {
  const db = makeDb();
  setDb(db);

  const usersRepo = new UsersRepository();
  const sessionsRepo = new SessionsRepository();
  const user = usersRepo.create({ name: 'Test User', email: 'test@example.com' });
  const session = await sessionsRepo.createAsync(user.id);
  const authHeaders: Record<string, string> = {
    Authorization: `Bearer ${session.token}`,
    'Content-Type': 'application/json',
  };

  const server = makeServer();
  await new Promise<void>((r) => server.once('listening', () => r()));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const closeServer = () =>
    new Promise<void>((res, rej) => {
      server.closeAllConnections();
      server.close((e) => (e ? rej(e) : res()));
    });

  return { baseUrl, closeServer, authHeaders };
}

describe('GET /agent-skills', () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let authHeaders: Record<string, string>;

  beforeEach(async () => {
    ({ baseUrl, closeServer, authHeaders } = await setup());
  });

  afterEach(async () => {
    await closeServer();
  });

  it('returns [] and 200 on an empty table (not 500)', async () => {
    const res = await fetch(`${baseUrl}/agent-skills`, { headers: authHeaders });
    expect(res.status).toBe(200);
    const skills = (await res.json()) as unknown[];
    expect(Array.isArray(skills)).toBe(true);
    expect(skills.length).toBe(0);
  });
});

describe('GET /agent-skills/:id', () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let authHeaders: Record<string, string>;

  beforeEach(async () => {
    ({ baseUrl, closeServer, authHeaders } = await setup());
  });

  afterEach(async () => {
    await closeServer();
  });

  it('returns a single skill by id', async () => {
    const createRes = await fetch(`${baseUrl}/agent-skills`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ title: 'Lookup Skill' }),
    });
    const created = (await createRes.json()) as Record<string, unknown>;

    const res = await fetch(`${baseUrl}/agent-skills/${created.id}`, { headers: authHeaders });
    expect(res.status).toBe(200);
    const skill = (await res.json()) as Record<string, unknown>;
    expect(skill.id).toBe(created.id);
    expect(skill.title).toBe('Lookup Skill');
  });

  it('returns 404 for unknown id', async () => {
    const res = await fetch(`${baseUrl}/agent-skills/nonexistent-id`, { headers: authHeaders });
    expect(res.status).toBe(404);
  });
});

describe('POST /agent-skills', () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let authHeaders: Record<string, string>;

  beforeEach(async () => {
    ({ baseUrl, closeServer, authHeaders } = await setup());
  });

  afterEach(async () => {
    await closeServer();
  });

  it('creates a new skill and returns 201', async () => {
    const body = {
      title: 'Draft a follow-up email',
      whenToUse: 'When a thread needs a reply',
      description: 'Compose a concise follow-up',
      steps: ['Read thread', 'Draft reply'],
      tags: ['email', 'writing'],
      confidence: 0.8,
      status: 'published',
      source: 'mined',
    };

    const res = await fetch(`${baseUrl}/agent-skills`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(body),
    });

    expect(res.status).toBe(201);
    const skill = (await res.json()) as Record<string, unknown>;
    expect(skill.title).toBe('Draft a follow-up email');
    expect(skill.status).toBe('published');
    expect(skill.confidence).toBe(0.8);
    expect(skill.steps).toEqual(['Read thread', 'Draft reply']);
    expect(skill.tags).toEqual(['email', 'writing']);
    expect(typeof skill.id).toBe('string');
  });

  it('creates a minimal skill (title only) with defaults', async () => {
    const res = await fetch(`${baseUrl}/agent-skills`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ title: 'Minimal' }),
    });
    expect(res.status).toBe(201);
    const skill = (await res.json()) as Record<string, unknown>;
    expect(skill.title).toBe('Minimal');
    expect(skill.status).toBe('draft');
    expect(skill.confidence).toBe(0);
  });

  it('returns 400 when title is missing', async () => {
    const res = await fetch(`${baseUrl}/agent-skills`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ description: 'no title' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when title is an empty string', async () => {
    const res = await fetch(`${baseUrl}/agent-skills`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ title: '   ' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for an invalid status', async () => {
    const res = await fetch(`${baseUrl}/agent-skills`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ title: 'Bad status', status: 'archived' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for a confidence out of range', async () => {
    const res = await fetch(`${baseUrl}/agent-skills`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ title: 'Bad confidence', confidence: 1.5 }),
    });
    expect(res.status).toBe(400);
  });
});

describe('PATCH /agent-skills/:id', () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let authHeaders: Record<string, string>;

  beforeEach(async () => {
    ({ baseUrl, closeServer, authHeaders } = await setup());
  });

  afterEach(async () => {
    await closeServer();
  });

  it('patches a skill and returns 200', async () => {
    const createRes = await fetch(`${baseUrl}/agent-skills`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ title: 'Original', status: 'draft' }),
    });
    const created = (await createRes.json()) as Record<string, unknown>;

    const res = await fetch(`${baseUrl}/agent-skills/${created.id}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ title: 'Updated', status: 'published' }),
    });
    expect(res.status).toBe(200);
    const updated = (await res.json()) as Record<string, unknown>;
    expect(updated.title).toBe('Updated');
    expect(updated.status).toBe('published');
  });

  it('returns 404 for unknown id', async () => {
    const res = await fetch(`${baseUrl}/agent-skills/nonexistent`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ title: 'whatever' }),
    });
    expect(res.status).toBe(404);
  });

  it('returns 400 when patching an invalid status', async () => {
    const createRes = await fetch(`${baseUrl}/agent-skills`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ title: 'Patch target' }),
    });
    const created = (await createRes.json()) as Record<string, unknown>;

    const res = await fetch(`${baseUrl}/agent-skills/${created.id}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ status: 'nope' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /agent-skills/:id', () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let authHeaders: Record<string, string>;

  beforeEach(async () => {
    ({ baseUrl, closeServer, authHeaders } = await setup());
  });

  afterEach(async () => {
    await closeServer();
  });

  it('deletes a skill and returns 204', async () => {
    const createRes = await fetch(`${baseUrl}/agent-skills`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ title: 'Temp Skill' }),
    });
    const created = (await createRes.json()) as Record<string, unknown>;

    const delRes = await fetch(`${baseUrl}/agent-skills/${created.id}`, {
      method: 'DELETE',
      headers: authHeaders,
    });
    expect(delRes.status).toBe(204);

    const getRes = await fetch(`${baseUrl}/agent-skills/${created.id}`, { headers: authHeaders });
    expect(getRes.status).toBe(404);
  });

  it('returns 404 for unknown id', async () => {
    const res = await fetch(`${baseUrl}/agent-skills/nonexistent`, {
      method: 'DELETE',
      headers: authHeaders,
    });
    expect(res.status).toBe(404);
  });
});
