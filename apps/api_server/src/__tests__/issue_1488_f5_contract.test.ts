/** Acceptance contract for PR #1488 review F5: async tools-map producers. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';

import { createApp } from '../app';
import { getDb, setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { SessionsRepository } from '../repositories/sessions_repository';
import { UsersRepository } from '../repositories/users_repository';
import { AGENT_CONFIG_BUNDLE_VERSION } from '../services/agent_config_export_import';
import { startTestServer } from './helpers/real_server';

const listMcp = vi.fn();
const listMcpToolIds = vi.fn();

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    isReady: true,
    listMcp: (...args: unknown[]) => listMcp(...args),
    listMcpToolIds: (...args: unknown[]) => listMcpToolIds(...args),
    reloadConfig: vi.fn().mockResolvedValue(true),
  },
  opencodeSessionMap: new Map(),
}));

vi.mock('../services/agent_profile_projection_service', () => ({
  projectAgentProfileAfterWrite: vi.fn(() => ({ kind: 'written' })),
}));

vi.mock('../services/ws_gateway', () => ({
  broadcastAgentConfigsChanged: vi.fn(),
}));

function bundleProfile(id: string, allowedMcpsJson: string, label = id) {
  return {
    id,
    label,
    icon: 'book',
    enabled: true,
    isAgent: true,
    isManager: false,
    systemPrompt: null,
    allowedMcpsJson,
    allowedSkillsJson: null,
    corePermissionsJson: null,
    allowedDelegatesJson: null,
    presetId: null,
    sortOrder: 100,
    modelProvider: null,
    modelId: null,
    ocAgent: null,
    sessionSelectable: true,
    modelTierHint: null,
  };
}

describe('PR #1488 F5 — async schedule/import tools-map validation', () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let headers: Record<string, string>;

  beforeEach(async () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);
    const user = new UsersRepository().create({ name: 'F5', email: 'f5@example.com' });
    const session = await new SessionsRepository().createAsync(user.id);
    headers = { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' };
    listMcp.mockReset().mockResolvedValue({ obsidian: { status: 'connected' } });
    listMcpToolIds.mockReset().mockResolvedValue(['obsidian_obsidian_simple_search']);
    ({ baseUrl, close: closeServer } = await startTestServer(createApp()));
  });

  afterEach(async () => {
    await closeServer();
  });

  it('rejects an unknown connected-server grant before a schedule update and preserves the whole row', async () => {
    // Regression caught: create/PATCH persisted phantom tools before validation.
    const countBeforeCreate = getDb()
      .prepare('SELECT COUNT(*) AS count FROM agent_scheduled_tasks')
      .get() as { count: number };
    const rejectedCreate = await fetch(`${baseUrl}/agent-schedules`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'must not be created',
        scheduleType: 'daily',
        scheduledTime: '05:00',
        prompt: 'Run',
        allowedMcps: { obsidian: ['obsidian_get_file'] },
      }),
    });
    expect(rejectedCreate.status).toBe(400);
    expect(await rejectedCreate.text()).toMatch(/unknown MCP tool grant.*obsidian\.obsidian_get_file/i);
    expect(
      getDb().prepare('SELECT COUNT(*) AS count FROM agent_scheduled_tasks').get(),
    ).toEqual(countBeforeCreate);

    const createdRes = await fetch(`${baseUrl}/agent-schedules`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'stable schedule',
        scheduleType: 'daily',
        scheduledTime: '05:00',
        prompt: 'Run',
        allowedMcps: { obsidian: ['obsidian_simple_search'] },
      }),
    });
    expect(createdRes.status).toBe(201);
    const created = (await createdRes.json()) as { id: string };
    const before = JSON.stringify(
      getDb().prepare('SELECT * FROM agent_scheduled_tasks WHERE id = ?').get(created.id),
    );

    const rejected = await fetch(`${baseUrl}/agent-schedules/${created.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        name: 'must not persist',
        scheduledTime: '06:00',
        allowedMcps: { obsidian: ['obsidian_get_file'] },
      }),
    });

    expect(rejected.status).toBe(400);
    expect(await rejected.text()).toMatch(/unknown MCP tool grant.*obsidian\.obsidian_get_file/i);
    expect(JSON.stringify(
      getDb().prepare('SELECT * FROM agent_scheduled_tasks WHERE id = ?').get(created.id),
    )).toBe(before);
  });

  it('rejects an invalid profile anywhere in an import before any profile row changes', async () => {
    // Regression caught: the importer updated earlier rows, then returned a later row-level error.
    const repo = new AgentConfigsRepository();
    repo.insert({ id: 'first-profile', label: 'Before first', icon: 'book' });
    repo.insert({ id: 'second-profile', label: 'Before second', icon: 'book' });
    const before = JSON.stringify(
      getDb().prepare('SELECT * FROM agent_configs WHERE id IN (?, ?) ORDER BY id').all(
        'first-profile',
        'second-profile',
      ),
    );
    const bundle = {
      version: AGENT_CONFIG_BUNDLE_VERSION,
      exportedAt: new Date().toISOString(),
      profiles: [
        bundleProfile(
          'first-profile',
          JSON.stringify({ obsidian: ['obsidian_simple_search'] }),
          'Would update first',
        ),
        bundleProfile(
          'second-profile',
          JSON.stringify({ obsidian: ['obsidian_get_file'] }),
          'Would update second',
        ),
      ],
    };

    const rejected = await fetch(`${baseUrl}/agent-configs/import`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ bundle }),
    });

    expect(rejected.status).toBe(400);
    expect(await rejected.text()).toMatch(/unknown MCP tool grant.*obsidian\.obsidian_get_file/i);
    expect(JSON.stringify(
      getDb().prepare('SELECT * FROM agent_configs WHERE id IN (?, ?) ORDER BY id').all(
        'first-profile',
        'second-profile',
      ),
    )).toBe(before);
  });

  it('persists valid connected-server grants through both schedule and import boundaries', async () => {
    // Regression caught: hardening failed closed even when the live catalog contained the grant.
    const allowed = { obsidian: ['obsidian_simple_search'] };
    const scheduleRes = await fetch(`${baseUrl}/agent-schedules`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'valid schedule',
        scheduleType: 'daily',
        scheduledTime: '05:00',
        prompt: 'Run',
        allowedMcps: allowed,
      }),
    });
    expect(scheduleRes.status).toBe(201);
    const schedule = (await scheduleRes.json()) as { allowedMcpsJson: string };
    expect(schedule.allowedMcpsJson).toBe(JSON.stringify(allowed));

    const importRes = await fetch(`${baseUrl}/agent-configs/import`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        bundle: {
          version: AGENT_CONFIG_BUNDLE_VERSION,
          exportedAt: new Date().toISOString(),
          profiles: [bundleProfile('valid-import', JSON.stringify(allowed))],
        },
      }),
    });
    expect(importRes.status).toBe(200);
    expect(new AgentConfigsRepository().getById('valid-import')?.allowedMcpsJson).toBe(
      JSON.stringify(allowed),
    );
  });

  it('does not judge grants belonging to a non-connected server', async () => {
    // Regression caught: needs_auth was treated as a complete catalog and blocked legitimate writes.
    listMcp.mockResolvedValue({ obsidian: { status: 'needs_auth' } });
    listMcpToolIds.mockResolvedValue([]);
    const allowed = { obsidian: ['obsidian_simple_search'] };

    const scheduleRes = await fetch(`${baseUrl}/agent-schedules`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'needs auth schedule', scheduleType: 'daily', scheduledTime: '05:00', prompt: 'Run',
        allowedMcps: allowed,
      }),
    });
    expect(scheduleRes.status).toBe(201);

    const importRes = await fetch(`${baseUrl}/agent-configs/import`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        bundle: {
          version: AGENT_CONFIG_BUNDLE_VERSION,
          exportedAt: new Date().toISOString(),
          profiles: [bundleProfile('needs-auth-import', JSON.stringify(allowed))],
        },
      }),
    });
    expect(importRes.status).toBe(200);
    expect(new AgentConfigsRepository().getById('needs-auth-import')).not.toBeNull();
  });

  it('fails open at both boundaries when the live catalog is unavailable', async () => {
    // Regression caught: engine warmup turned routine schedule/import writes into false 400s.
    listMcp.mockRejectedValue(new Error('engine warming up'));
    const allowed = { obsidian: ['obsidian_simple_search'] };

    const scheduleRes = await fetch(`${baseUrl}/agent-schedules`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'cold engine schedule', scheduleType: 'daily', scheduledTime: '05:00', prompt: 'Run',
        allowedMcps: allowed,
      }),
    });
    expect(scheduleRes.status).toBe(201);

    const importRes = await fetch(`${baseUrl}/agent-configs/import`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        bundle: {
          version: AGENT_CONFIG_BUNDLE_VERSION,
          exportedAt: new Date().toISOString(),
          profiles: [bundleProfile('cold-engine-import', JSON.stringify(allowed))],
        },
      }),
    });
    expect(importRes.status).toBe(200);
    expect(new AgentConfigsRepository().getById('cold-engine-import')).not.toBeNull();
  });
});
