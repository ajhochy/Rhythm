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
  return createApp().listen(0);
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
    new Promise<void>((res, rej) => server.close((e) => (e ? rej(e) : res())));

  return { baseUrl, closeServer, authHeaders };
}

describe('GET /agent-configs', () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let authHeaders: Record<string, string>;

  beforeEach(async () => {
    ({ baseUrl, closeServer, authHeaders } = await setup());
  });

  afterEach(async () => {
    await closeServer();
  });

  it('returns all seeded preset rows', async () => {
    const res = await fetch(`${baseUrl}/agent-configs`, { headers: authHeaders });
    expect(res.status).toBe(200);
    const configs = (await res.json()) as Array<{ id: string }>;
    expect(Array.isArray(configs)).toBe(true);
    expect(configs.length).toBe(4);
    const ids = configs.map((c) => c.id);
    expect(ids).toContain('claude-code');
    expect(ids).toContain('codex');
    expect(ids).toContain('gemini-cli');
    expect(ids).toContain('opencode');
  });
});

describe('GET /agent-configs/:id', () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let authHeaders: Record<string, string>;

  beforeEach(async () => {
    ({ baseUrl, closeServer, authHeaders } = await setup());
  });

  afterEach(async () => {
    await closeServer();
  });

  it('returns a single config by id', async () => {
    const res = await fetch(`${baseUrl}/agent-configs/claude-code`, { headers: authHeaders });
    expect(res.status).toBe(200);
    const config = (await res.json()) as Record<string, unknown>;
    expect(config.id).toBe('claude-code');
    expect(config.label).toBe('Claude Code');
    expect(config.presetId).toBe('claude-code');
  });

  it('returns 404 for unknown id', async () => {
    const res = await fetch(`${baseUrl}/agent-configs/nonexistent-id`, { headers: authHeaders });
    expect(res.status).toBe(404);
  });
});

describe('POST /agent-configs', () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let authHeaders: Record<string, string>;

  beforeEach(async () => {
    ({ baseUrl, closeServer, authHeaders } = await setup());
  });

  afterEach(async () => {
    await closeServer();
  });

  it('creates a new custom config and returns 201', async () => {
    const body = {
      label: 'My Custom Agent',
      command: 'myagent --run',
      isAgent: true,
      canResume: false,
    };

    const res = await fetch(`${baseUrl}/agent-configs`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(body),
    });

    expect(res.status).toBe(201);
    const config = (await res.json()) as Record<string, unknown>;
    expect(config.label).toBe('My Custom Agent');
    // Legacy `command` field is no longer echoed back (issue #581).
    expect(config.command).toBeUndefined();
    expect(config.presetId).toBeNull();
    expect(typeof config.id).toBe('string');
  });

  it('creates a config with canResume and resumeCommand', async () => {
    const body = {
      label: 'Resumable Agent',
      command: 'myagent',
      isAgent: true,
      canResume: true,
      resumeCommand: 'myagent --resume {{sessionId}}',
    };

    const res = await fetch(`${baseUrl}/agent-configs`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(body),
    });

    expect(res.status).toBe(201);
    const config = (await res.json()) as Record<string, unknown>;
    // Legacy fields are no longer persisted or echoed back (issue #581).
    // The route still accepts them on input for back-compat with stale clients.
    expect(config.canResume).toBeUndefined();
    expect(config.resumeCommand).toBeUndefined();
  });

  it('returns 400 when label is missing', async () => {
    const res = await fetch(`${baseUrl}/agent-configs`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ command: 'myagent' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when command is missing', async () => {
    const res = await fetch(`${baseUrl}/agent-configs`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ label: 'My Agent' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when label is empty string', async () => {
    const res = await fetch(`${baseUrl}/agent-configs`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ label: '   ', command: 'myagent' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when canResume is true but resumeCommand missing', async () => {
    const res = await fetch(`${baseUrl}/agent-configs`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ label: 'Agent', command: 'myagent', canResume: true }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when resumeCommand lacks {{sessionId}}', async () => {
    const res = await fetch(`${baseUrl}/agent-configs`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        label: 'Agent',
        command: 'myagent',
        canResume: true,
        resumeCommand: 'myagent --resume',
      }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when sessionIdPattern is not a valid regex', async () => {
    const res = await fetch(`${baseUrl}/agent-configs`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        label: 'Agent',
        command: 'myagent',
        sessionIdPattern: '[invalid(',
      }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when isAgent is false but canResume is true', async () => {
    const res = await fetch(`${baseUrl}/agent-configs`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        label: 'Agent',
        command: 'myagent',
        isAgent: false,
        canResume: true,
        resumeCommand: 'myagent --resume {{sessionId}}',
      }),
    });
    expect(res.status).toBe(400);
  });

  it('forces canResume to false when isAgent is false', async () => {
    const res = await fetch(`${baseUrl}/agent-configs`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        label: 'Tool',
        command: 'mytool',
        isAgent: false,
      }),
    });
    expect(res.status).toBe(201);
    const config = (await res.json()) as Record<string, unknown>;
    expect(config.isAgent).toBe(false);
    // Legacy `canResume` field is no longer echoed back (issue #581).
    expect(config.canResume).toBeUndefined();
  });
});

describe('PATCH /agent-configs/:id', () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let authHeaders: Record<string, string>;

  beforeEach(async () => {
    ({ baseUrl, closeServer, authHeaders } = await setup());
  });

  afterEach(async () => {
    await closeServer();
  });

  it('patches a custom config label', async () => {
    // Create custom config first
    const createRes = await fetch(`${baseUrl}/agent-configs`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ label: 'Original', command: 'myagent' }),
    });
    const created = (await createRes.json()) as Record<string, unknown>;

    const res = await fetch(`${baseUrl}/agent-configs/${created.id}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ label: 'Updated' }),
    });
    expect(res.status).toBe(200);
    const updated = (await res.json()) as Record<string, unknown>;
    expect(updated.label).toBe('Updated');
  });

  it('allows patching enabled on a preset row', async () => {
    const res = await fetch(`${baseUrl}/agent-configs/claude-code`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ enabled: false }),
    });
    expect(res.status).toBe(200);
    const updated = (await res.json()) as Record<string, unknown>;
    expect(updated.enabled).toBe(false);
  });

  it('allows patching command on a preset row', async () => {
    const res = await fetch(`${baseUrl}/agent-configs/claude-code`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ command: 'claude --custom-flag' }),
    });
    expect(res.status).toBe(200);
    const updated = (await res.json()) as Record<string, unknown>;
    // Legacy `command` field is silently ignored on write and no longer echoed
    // back; the patch succeeds but the field is absent on the response (#581).
    expect(updated.command).toBeUndefined();
  });

  it('returns 400 when patching label on a preset row', async () => {
    const res = await fetch(`${baseUrl}/agent-configs/claude-code`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ label: 'Renamed Claude' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when patching icon on a preset row', async () => {
    const res = await fetch(`${baseUrl}/agent-configs/codex`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ icon: 'new-icon.png' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when patching isAgent on a preset row', async () => {
    const res = await fetch(`${baseUrl}/agent-configs/claude-code`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ isAgent: false }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown id', async () => {
    const res = await fetch(`${baseUrl}/agent-configs/nonexistent`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ enabled: true }),
    });
    expect(res.status).toBe(404);
  });

  it('returns 400 when patch would set canResume true with no resumeCommand', async () => {
    const createRes = await fetch(`${baseUrl}/agent-configs`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ label: 'Orig', command: 'myagent' }),
    });
    const created = (await createRes.json()) as Record<string, unknown>;

    const res = await fetch(`${baseUrl}/agent-configs/${created.id}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ canResume: true }),
    });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /agent-configs/:id', () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let authHeaders: Record<string, string>;

  beforeEach(async () => {
    ({ baseUrl, closeServer, authHeaders } = await setup());
  });

  afterEach(async () => {
    await closeServer();
  });

  it('deletes a custom config and returns 204', async () => {
    const createRes = await fetch(`${baseUrl}/agent-configs`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ label: 'Temp Agent', command: 'tempagent' }),
    });
    const created = (await createRes.json()) as Record<string, unknown>;

    const delRes = await fetch(`${baseUrl}/agent-configs/${created.id}`, {
      method: 'DELETE',
      headers: authHeaders,
    });
    expect(delRes.status).toBe(204);

    // Confirm it's gone
    const getRes = await fetch(`${baseUrl}/agent-configs/${created.id}`, {
      headers: authHeaders,
    });
    expect(getRes.status).toBe(404);
  });

  it('returns 400 when trying to delete a preset row', async () => {
    const res = await fetch(`${baseUrl}/agent-configs/claude-code`, {
      method: 'DELETE',
      headers: authHeaders,
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown id', async () => {
    const res = await fetch(`${baseUrl}/agent-configs/nonexistent`, {
      method: 'DELETE',
      headers: authHeaders,
    });
    expect(res.status).toBe(404);
  });
});
