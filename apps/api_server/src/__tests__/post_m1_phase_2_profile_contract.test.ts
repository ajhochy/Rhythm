import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startTestServer } from './helpers/real_server';

vi.mock('../services/ws_gateway', () => ({
  broadcast: vi.fn(),
  broadcastSessionUpdated: vi.fn(),
  broadcastSessionRemoved: vi.fn(),
  broadcastAgentConfigsChanged: vi.fn(),
}));

vi.mock('../services/opencode_agent_writer', async (importOriginal) => {
  const original = await importOriginal<typeof import('../services/opencode_agent_writer')>();
  return {
    ...original,
    writeAgentProfileFile: vi.fn(() => 'written'),
    deleteAgentProfileFile: vi.fn(),
    syncAgentProfileFileForState: vi.fn(),
  };
});

type Scenario = {
  db: Database.Database;
  baseUrl: string;
  authHeaders: Record<string, string>;
  close(): Promise<void>;
};

let scenario: Scenario | undefined;

async function startScenario(): Promise<Scenario> {
  const { env } = await import('../config/env');
  env.agentLocal = false;
  env.agentExecutionEnabled = true;

  const { setDb } = await import('../database/db');
  const { runMigrations } = await import('../database/migrations');
  const { UsersRepository } = await import('../repositories/users_repository');
  const { SessionsRepository } = await import('../repositories/sessions_repository');
  const { createApp } = await import('../app');

  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
  const user = new UsersRepository().create({
    name: 'Phase 2 profile contract',
    email: 'phase-2-profile@example.invalid',
  });
  const authSession = await new SessionsRepository().createAsync(user.id);
  const server = await startTestServer(createApp());
  return {
    db,
    baseUrl: server.baseUrl,
    authHeaders: {
      Authorization: `Bearer ${authSession.token}`,
      'Content-Type': 'application/json',
    },
    async close() {
      await server.close();
      db.close();
    },
  };
}

beforeEach(async () => {
  scenario = await startScenario();
});

afterEach(async () => {
  await scenario?.close();
  scenario = undefined;
  vi.restoreAllMocks();
});

describe('post-m1 Phase 2 canonical profile API contract', () => {
  it('post-m1-p2-c1b-api: create persists API modelProvider/modelId as DB model_provider/model_id', async () => {
    // Regression caught: the API accepts React display aliases or loses the canonical pair between
    // its response and SQLite; the response/row equality assertion fails.
    const body = {
      label: 'Phase 2 Canonical Create',
      icon: 'P2',
      enabled: true,
      isAgent: true,
      isManager: false,
      systemPrompt: 'Preserve canonical identity.',
      allowedMcpsJson: '["rhythm"]',
      allowedSkillsJson: '["verification"]',
      corePermissionsJson: '{"shell":"ask"}',
      allowedDelegatesJson: '[]',
      sortOrder: 42,
      modelProvider: 'anthropic',
      modelId: 'claude-sonnet-4-6',
      ocAgent: 'phase-2-canonical-create',
      sessionSelectable: true,
      modelTierHint: null,
      defaultAnthropicAccountId: null,
    };

    const response = await fetch(`${scenario!.baseUrl}/agent-configs`, {
      method: 'POST',
      headers: scenario!.authHeaders,
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(201);
    const created = await response.json() as Record<string, unknown>;
    expect(created).toMatchObject({ ...body, id: 'phase-2-canonical-create' });
    expect(created).not.toHaveProperty('provider');
    expect(created).not.toHaveProperty('model');

    const row = scenario!.db.prepare(
      'SELECT id, model_provider, model_id FROM agent_configs WHERE id = ?',
    ).get(created.id) as Record<string, unknown>;
    expect(row).toEqual({
      id: created.id,
      model_provider: body.modelProvider,
      model_id: body.modelId,
    });
  });

  it('post-m1-p2-c1c-api: patch round-trips canonical model fields and explicit nulls only', async () => {
    // Regression caught: PATCH stores display-only provider/model fields or collapses explicit null;
    // the canonical response/row assertions fail.
    const createResponse = await fetch(`${scenario!.baseUrl}/agent-configs`, {
      method: 'POST',
      headers: scenario!.authHeaders,
      body: JSON.stringify({
        id: 'phase-2-canonical-edit',
        label: 'Phase 2 Canonical Edit',
        modelProvider: 'anthropic',
        modelId: 'claude-sonnet-4-6',
      }),
    });
    expect(createResponse.status).toBe(201);

    const patchResponse = await fetch(
      `${scenario!.baseUrl}/agent-configs/phase-2-canonical-edit`,
      {
        method: 'PATCH',
        headers: scenario!.authHeaders,
        body: JSON.stringify({
          modelProvider: 'openai',
          modelId: 'gpt-5.6-terra',
        }),
      },
    );
    expect(patchResponse.status).toBe(200);
    const patched = await patchResponse.json() as Record<string, unknown>;
    expect(patched).toMatchObject({
      id: 'phase-2-canonical-edit',
      modelProvider: 'openai',
      modelId: 'gpt-5.6-terra',
    });
    expect(patched).not.toHaveProperty('provider');
    expect(patched).not.toHaveProperty('model');

    const rowAfterPatch = scenario!.db.prepare(
      'SELECT model_provider, model_id FROM agent_configs WHERE id = ?',
    ).get('phase-2-canonical-edit');
    expect(rowAfterPatch).toEqual({
      model_provider: 'openai',
      model_id: 'gpt-5.6-terra',
    });

    const clearResponse = await fetch(
      `${scenario!.baseUrl}/agent-configs/phase-2-canonical-edit`,
      {
        method: 'PATCH',
        headers: scenario!.authHeaders,
        body: JSON.stringify({ modelProvider: null, modelId: null }),
      },
    );
    expect(clearResponse.status).toBe(200);
    expect(await clearResponse.json()).toMatchObject({
      modelProvider: null,
      modelId: null,
    });
    expect(scenario!.db.prepare(
      'SELECT model_provider, model_id FROM agent_configs WHERE id = ?',
    ).get('phase-2-canonical-edit')).toEqual({
      model_provider: null,
      model_id: null,
    });
  });
});
