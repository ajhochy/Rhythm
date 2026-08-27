import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createApp } from '../app';
import { runMigrations } from '../database/migrations';
import { getDb, setDb } from '../database/db';
import { UsersRepository } from '../repositories/users_repository';
import { SessionsRepository } from '../repositories/sessions_repository';
import { startTestServer } from './helpers/real_server';
import { opencodeClient } from '../services/opencode_engine';
import * as writer from '../services/opencode_agent_writer';

const { broadcastAgentConfigsChangedSpy } = vi.hoisted(() => ({
  broadcastAgentConfigsChangedSpy: vi.fn(),
}));

vi.mock('../services/ws_gateway', () => ({
  broadcast: vi.fn(),
  broadcastSessionUpdated: vi.fn(),
  broadcastSessionRemoved: vi.fn(),
  broadcastAgentConfigsChanged: broadcastAgentConfigsChangedSpy,
}));

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

async function setup() {
  broadcastAgentConfigsChangedSpy.mockClear();
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
    expect(broadcastAgentConfigsChangedSpy).toHaveBeenCalledTimes(1);
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

  // #1088 — schedulable decoupled from sessionSelectable (picker visibility).
  it('accepts an explicit schedulable override independent of sessionSelectable (#1088)', async () => {
    const res = await fetch(`${baseUrl}/agent-configs`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ label: 'Hidden Specialist', sessionSelectable: false, schedulable: true }),
    });
    expect(res.status).toBe(201);
    const config = (await res.json()) as Record<string, unknown>;
    expect(config.sessionSelectable).toBe(false);
    expect(config.schedulable).toBe(true);
  });

  it('schedulable defaults to null (inherits sessionSelectable) when omitted (#1088)', async () => {
    const res = await fetch(`${baseUrl}/agent-configs`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ label: 'Default Schedulable' }),
    });
    expect(res.status).toBe(201);
    const config = (await res.json()) as Record<string, unknown>;
    expect(config.schedulableOverride).toBeNull();
    expect(config.schedulable).toBe(true); // sessionSelectable defaults true
  });

  // #1094 — OpenAI native image_generation capability grant.
  it('creates a config with imageGenerationEnabled granted (#1094)', async () => {
    const res = await fetch(`${baseUrl}/agent-configs`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ label: 'Graphic Designer', imageGenerationEnabled: true }),
    });
    expect(res.status).toBe(201);
    const config = (await res.json()) as Record<string, unknown>;
    expect(config.imageGenerationEnabled).toBe(true);
  });

  it('imageGenerationEnabled defaults to false (#1094)', async () => {
    const res = await fetch(`${baseUrl}/agent-configs`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ label: 'Plain Agent' }),
    });
    expect(res.status).toBe(201);
    const config = (await res.json()) as Record<string, unknown>;
    expect(config.imageGenerationEnabled).toBe(false);
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
    broadcastAgentConfigsChangedSpy.mockClear();

    const res = await fetch(`${baseUrl}/agent-configs/${created.id}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ label: 'Updated' }),
    });
    expect(res.status).toBe(200);
    const updated = (await res.json()) as Record<string, unknown>;
    expect(updated.label).toBe('Updated');
    expect(broadcastAgentConfigsChangedSpy).toHaveBeenCalledTimes(1);
  });

  it('patches schedulable independent of sessionSelectable, and null clears the override (#1088)', async () => {
    const createRes = await fetch(`${baseUrl}/agent-configs`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ label: 'Hidden', sessionSelectable: false }),
    });
    const created = (await createRes.json()) as Record<string, unknown>;

    const patchRes = await fetch(`${baseUrl}/agent-configs/${created.id}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ schedulable: true }),
    });
    expect(patchRes.status).toBe(200);
    const patched = (await patchRes.json()) as Record<string, unknown>;
    expect(patched.sessionSelectable).toBe(false);
    expect(patched.schedulable).toBe(true);

    const clearRes = await fetch(`${baseUrl}/agent-configs/${created.id}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ schedulable: null }),
    });
    const cleared = (await clearRes.json()) as Record<string, unknown>;
    expect(cleared.schedulableOverride).toBeNull();
    expect(cleared.schedulable).toBe(false); // falls back to sessionSelectable=false
  });

  it('patches imageGenerationEnabled (#1094)', async () => {
    const createRes = await fetch(`${baseUrl}/agent-configs`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ label: 'Designer' }),
    });
    const created = (await createRes.json()) as Record<string, unknown>;

    const res = await fetch(`${baseUrl}/agent-configs/${created.id}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ imageGenerationEnabled: true }),
    });
    expect(res.status).toBe(200);
    const updated = (await res.json()) as Record<string, unknown>;
    expect(updated.imageGenerationEnabled).toBe(true);
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
    // #1015 also reloads on create(); measure only the patch's reload.
    reloadConfig.mockClear();

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

  it('patches reasoningEffort, GET returns it, and null clears it (#1118)', async () => {
    const createRes = await fetch(`${baseUrl}/agent-configs`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ label: 'Deep Thinker' }),
    });
    const created = (await createRes.json()) as Record<string, unknown>;
    expect(created.reasoningEffort).toBeNull();

    const patchRes = await fetch(`${baseUrl}/agent-configs/${created.id}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ reasoningEffort: 'high' }),
    });
    expect(patchRes.status).toBe(200);
    const patched = (await patchRes.json()) as Record<string, unknown>;
    expect(patched.reasoningEffort).toBe('high');

    const getRes = await fetch(`${baseUrl}/agent-configs/${created.id}`, { headers: authHeaders });
    const fetched = (await getRes.json()) as Record<string, unknown>;
    expect(fetched.reasoningEffort).toBe('high');

    const clearRes = await fetch(`${baseUrl}/agent-configs/${created.id}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ reasoningEffort: null }),
    });
    expect(clearRes.status).toBe(200);
    expect(((await clearRes.json()) as Record<string, unknown>).reasoningEffort).toBeNull();
  });

  it('returns 400 for an empty-string reasoningEffort (#1118)', async () => {
    const createRes = await fetch(`${baseUrl}/agent-configs`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ label: 'Bad Effort' }),
    });
    const created = (await createRes.json()) as Record<string, unknown>;

    const res = await fetch(`${baseUrl}/agent-configs/${created.id}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ reasoningEffort: '' }),
    });
    expect(res.status).toBe(400);
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
    broadcastAgentConfigsChangedSpy.mockClear();

    const delRes = await fetch(`${baseUrl}/agent-configs/${created.id}`, {
      method: 'DELETE',
      headers: authHeaders,
    });
    expect(delRes.status).toBe(204);
    expect(broadcastAgentConfigsChangedSpy).toHaveBeenCalledTimes(1);

    // Confirm it's gone
    const getRes = await fetch(`${baseUrl}/agent-configs/${created.id}`, {
      headers: authHeaders,
    });
    expect(getRes.status).toBe(404);
  });

  it('pr-1489-cleanup-c1: deletes its projection without touching another profile', async () => {
    const create = async (id: string) => {
      const response = await fetch(`${baseUrl}/agent-configs`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ id, label: id, isAgent: true }),
      });
      expect(response.status).toBe(201);
    };
    await create('projection-delete-target');
    await create('projection-delete-bystander');
    expect(getDb().prepare('SELECT profile_id FROM agent_profile_projections ORDER BY profile_id').all())
      .toEqual([
        { profile_id: 'projection-delete-bystander' },
        { profile_id: 'projection-delete-target' },
      ]);
    const deleteFile = vi.spyOn(writer, 'deleteAgentProfileFile');

    try {
      const response = await fetch(`${baseUrl}/agent-configs/projection-delete-target`, {
        method: 'DELETE',
        headers: authHeaders,
      });
      expect(response.status).toBe(204);
      expect(deleteFile).toHaveBeenCalledWith('projection-delete-target');
      expect(getDb().prepare('SELECT id FROM agent_configs WHERE id = ?').get('projection-delete-target'))
        .toBeUndefined();
      expect(getDb().prepare('SELECT profile_id FROM agent_profile_projections ORDER BY profile_id').all())
        .toEqual([{ profile_id: 'projection-delete-bystander' }]);
    } finally {
      deleteFile.mockRestore();
    }
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
    expect(broadcastAgentConfigsChangedSpy).toHaveBeenCalledTimes(1);
  });

  it('404s for an unknown id', async () => {
    const res = await fetch(`${baseUrl}/agent-configs/does-not-exist/resync-agent-file`, {
      method: 'POST',
      headers: authHeaders,
    });
    expect(res.status).toBe(404);
  });

  // A blocked or failed write leaves the agent file stale on disk. Before this,
  // the endpoint answered 200 either way, so "resynced" and "silently did
  // nothing" were indistinguishable to the caller.
  it('400s when the content scanner blocks the write', async () => {
    const spy = vi.spyOn(writer, 'writeAgentProfileFile').mockReturnValue('blocked');
    try {
      const res = await fetch(`${baseUrl}/agent-configs/config-doctor/resync-agent-file`, {
        method: 'POST',
        headers: authHeaders,
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error?: { message?: string } };
      const message = JSON.stringify(body);
      expect(message).toContain('content scanner');
      // The rejected prompt must never be echoed back to the caller.
      expect(message).not.toContain('system_prompt');
      expect(broadcastAgentConfigsChangedSpy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('500s when the write itself fails', async () => {
    const spy = vi.spyOn(writer, 'writeAgentProfileFile').mockReturnValue('failed');
    try {
      const res = await fetch(`${baseUrl}/agent-configs/config-doctor/resync-agent-file`, {
        method: 'POST',
        headers: authHeaders,
      });
      expect(res.status).toBe(500);
      expect(broadcastAgentConfigsChangedSpy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
