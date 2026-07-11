import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createApp } from '../app';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { UsersRepository } from '../repositories/users_repository';
import { SessionsRepository } from '../repositories/sessions_repository';
import { startTestServer } from './helpers/real_server';
import { opencodeClient } from '../services/opencode_engine';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
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

  const { baseUrl, close: closeServer } = await startTestServer(createApp());

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

  it('returns all seeded preset rows plus the Config Doctor and Rhythm Setup profiles', async () => {
    const res = await fetch(`${baseUrl}/agent-configs`, { headers: authHeaders });
    expect(res.status).toBe(200);
    const configs = (await res.json()) as Array<{ id: string }>;
    expect(Array.isArray(configs)).toBe(true);
    expect(configs.length).toBe(6);
    const ids = configs.map((c) => c.id);
    expect(ids).toContain('claude-code');
    expect(ids).toContain('codex');
    expect(ids).toContain('gemini-cli');
    expect(ids).toContain('opencode');
    expect(ids).toContain('config-doctor');
    expect(ids).toContain('rhythm-setup');
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
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  it('honors a custom slug id on create', async () => {
    const res = await fetch(`${baseUrl}/agent-configs`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ id: 'care-team', label: 'Care Team' }),
    });

    expect(res.status).toBe(201);
    const config = (await res.json()) as Record<string, unknown>;
    expect(config.id).toBe('care-team');
    expect(config.label).toBe('Care Team');
  });

  it('returns 400 when a custom id is not a slug', async () => {
    const res = await fetch(`${baseUrl}/agent-configs`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ id: 'Care Team', label: 'Care Team' }),
    });

    expect(res.status).toBe(400);
  });

  it('returns 409 when a custom id already exists', async () => {
    const res = await fetch(`${baseUrl}/agent-configs`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ id: 'claude-code', label: 'Custom Claude' }),
    });

    expect(res.status).toBe(409);
  });

  it('returns 400 when a custom id is reserved for an opencode internal preset', async () => {
    const res = await fetch(`${baseUrl}/agent-configs`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ id: 'build', label: 'Build' }),
    });

    expect(res.status).toBe(400);
  });

  it('derives a slug id from label when no id is supplied', async () => {
    const res = await fetch(`${baseUrl}/agent-configs`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ label: 'Pastoral Care Agent' }),
    });

    expect(res.status).toBe(201);
    const config = (await res.json()) as Record<string, unknown>;
    expect(config.id).toBe('pastoral-care-agent');
    expect(String(config.id)).not.toMatch(uuidRe);
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

  // After #581 the legacy CLI fields (command, canResume, resumeCommand,
  // sessionIdPattern, outputMarker) are no longer required or validated.
  // They are accepted on the wire for back-compat with stale clients but
  // never propagate to the repository.
  it('accepts a create without command (legacy field, #581)', async () => {
    const res = await fetch(`${baseUrl}/agent-configs`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ label: 'My Agent' }),
    });
    expect(res.status).toBe(201);
  });

  it('returns 400 when label is empty string', async () => {
    const res = await fetch(`${baseUrl}/agent-configs`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ label: '   ' }),
    });
    expect(res.status).toBe(400);
  });

  it('accepts legacy canResume/resumeCommand fields without validating them (#581)', async () => {
    const res = await fetch(`${baseUrl}/agent-configs`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ label: 'Agent', canResume: true }),
    });
    // Used to be 400; legacy validation removed.
    expect(res.status).toBe(201);
    const config = (await res.json()) as Record<string, unknown>;
    expect(config.canResume).toBeUndefined();
  });

  it('accepts an invalid legacy sessionIdPattern without validating (#581)', async () => {
    const res = await fetch(`${baseUrl}/agent-configs`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        label: 'Agent',
        sessionIdPattern: '[invalid(',
      }),
    });
    expect(res.status).toBe(201);
  });

  it('accepts isAgent=false even with a legacy canResume flag (#581)', async () => {
    const res = await fetch(`${baseUrl}/agent-configs`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        label: 'Agent',
        isAgent: false,
        canResume: true,
      }),
    });
    expect(res.status).toBe(201);
  });

  it('creates a config with validated corePermissionsJson', async () => {
    const res = await fetch(`${baseUrl}/agent-configs`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ label: 'Reader', corePermissionsJson: '{"read":"allow","bash":"ask"}' }),
    });
    expect(res.status).toBe(201);
    const config = (await res.json()) as Record<string, unknown>;
    expect(config.corePermissionsJson).toBe('{"read":"allow","bash":"ask"}');
  });

  it('rejects invalid corePermissionsJson', async () => {
    const res = await fetch(`${baseUrl}/agent-configs`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ label: 'Bad Reader', corePermissionsJson: '{"bash":"sure"}' }),
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

  it('issue-1014: reloads engine profiles when a delegate roster is patched', async () => {
    // Regression caught: the PATCH persists the new roster but the running
    // engine keeps its cached task allowlist for subsequent calls in this session.
    const reloadConfig = vi.spyOn(opencodeClient, 'reloadConfig').mockResolvedValue(false);
    const createRes = await fetch(`${baseUrl}/agent-configs`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ id: 'manager', label: 'Manager', isManager: true }),
    });
    expect(createRes.status).toBe(201);

    const patchRes = await fetch(`${baseUrl}/agent-configs/manager`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ allowedDelegatesJson: '["config-doctor"]' }),
    });

    expect(patchRes.status).toBe(200);
    expect(reloadConfig).toHaveBeenCalledTimes(1);
    reloadConfig.mockRestore();
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

  it('accepts a legacy canResume patch without validating (#581)', async () => {
    const createRes = await fetch(`${baseUrl}/agent-configs`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ label: 'Orig' }),
    });
    const created = (await createRes.json()) as Record<string, unknown>;

    const res = await fetch(`${baseUrl}/agent-configs/${created.id}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ canResume: true }),
    });
    // Used to be 400; legacy fields ignored now.
    expect(res.status).toBe(200);
  });

  it('patches and clears corePermissionsJson while preserving omitted fields', async () => {
    const createRes = await fetch(`${baseUrl}/agent-configs`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ label: 'Core Perms', allowedMcpsJson: '["rhythm"]' }),
    });
    const created = (await createRes.json()) as Record<string, unknown>;

    const patchRes = await fetch(`${baseUrl}/agent-configs/${created.id}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ corePermissionsJson: '{"skill":"allow"}' }),
    });
    expect(patchRes.status).toBe(200);
    const patched = (await patchRes.json()) as Record<string, unknown>;
    expect(patched.corePermissionsJson).toBe('{"skill":"allow"}');
    expect(patched.allowedMcpsJson).toBe('["rhythm"]');

    const clearRes = await fetch(`${baseUrl}/agent-configs/${created.id}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ corePermissionsJson: null }),
    });
    expect(clearRes.status).toBe(200);
    expect(((await clearRes.json()) as Record<string, unknown>).corePermissionsJson).toBeNull();
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

describe('POST /agent-configs/:id/resync-agent-file', () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let authHeaders: Record<string, string>;

  beforeEach(async () => {
    ({ baseUrl, closeServer, authHeaders } = await setup());
  });

  afterEach(async () => {
    await closeServer();
  });

  it('returns the config for a known id', async () => {
    const res = await fetch(`${baseUrl}/agent-configs/config-doctor/resync-agent-file`, {
      method: 'POST',
      headers: authHeaders,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; label: string };
    expect(body.id).toBe('config-doctor');
    expect(body.label).toBe('Config Doctor');
  });

  it('404s for an unknown id', async () => {
    const res = await fetch(`${baseUrl}/agent-configs/does-not-exist/resync-agent-file`, {
      method: 'POST',
      headers: authHeaders,
    });
    expect(res.status).toBe(404);
  });
});
