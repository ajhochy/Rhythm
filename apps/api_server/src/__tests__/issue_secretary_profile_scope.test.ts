/**
 * Acceptance contract: Secretary profile scope must be applied during the
 * initial POST /agent-sessions lifecycle.
 *
 * Regression caught: the controller creates the opencode session before the
 * WS gateway derives profile scope, so createSession receives undefined and
 * the persisted Rhythm session has no effective MCP scope.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import os from 'node:os';
import type { AddressInfo } from 'node:net';
import { createApp } from '../app';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { UsersRepository } from '../repositories/users_repository';
import { SessionsRepository } from '../repositories/sessions_repository';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';

const { mockCreateSession } = vi.hoisted(() => ({
  mockCreateSession: vi.fn().mockResolvedValue({ id: 'sdk-secretary-scope' }),
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    get isReady() {
      return true;
    },
    statusMessage: 'Opencode SDK ready',
    ensureReady: vi.fn().mockResolvedValue(true),
    createSession: mockCreateSession,
    listProviders: vi.fn().mockResolvedValue(['anthropic']),
    listAuthedProviders: vi.fn().mockResolvedValue(['anthropic']),
  },
  opencodeSessionMap: new Map<string, string>(),
}));

vi.mock('../services/opencode_stream_bridge', () => ({
  streamBridge: {
    streamSession: vi.fn().mockResolvedValue(undefined),
    stopStream: vi.fn(),
    clearErrorStatus: vi.fn(),
    dispose: vi.fn(),
  },
}));

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

describe('issue-secretary-profile-scope acceptance contract', () => {
  let baseUrl: string;
  let authHeaders: Record<string, string>;
  let closeServer: () => Promise<void>;

  beforeEach(async () => {
    setDb(makeDb());
    mockCreateSession.mockReset();
    mockCreateSession.mockResolvedValue({ id: 'sdk-secretary-scope' });

    const user = new UsersRepository().create({
      name: 'Secretary Scope Test',
      email: 'secretary-scope@example.com',
    });
    const authSession = await new SessionsRepository().createAsync(user.id);
    authHeaders = {
      Authorization: `Bearer ${authSession.token}`,
      'Content-Type': 'application/json',
    };

    new AgentConfigsRepository().insert({
      id: 'secretary',
      label: 'Secretary',
      icon: '🗂️',
      allowedMcpsJson: JSON.stringify(['rhythm']),
    });

    const server = createApp().listen(0);
    server.maxRequestsPerSocket = 1;
    await new Promise<void>((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    closeServer = () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      });
  });

  afterEach(async () => {
    await closeServer();
    vi.clearAllMocks();
  });

  it('issue-secretary-profile-scope-c1: POST applies and persists Secretary profile MCP scope before opencode session creation', async () => {
    const response = await fetch(`${baseUrl}/agent-sessions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        agentId: 'secretary',
        cwd: os.homedir(),
        name: 'Secretary scope contract',
      }),
    });

    expect(response.status).toBe(201);
    const created = (await response.json()) as { id: string };
    const expectedAllowedMcpsJson = JSON.stringify(['rhythm']);
    const expectedMcpRoleConfig = {
      role: 'secretary',
      mcpServers: {
        rhythm: { allowedTools: [] },
      },
      allowedToolsJson: expectedAllowedMcpsJson,
    };

    expect(mockCreateSession).toHaveBeenCalledWith(
      'Secretary scope contract',
      os.homedir(),
      expectedMcpRoleConfig,
    );
    const createArgs = mockCreateSession.mock.calls[0] as unknown as [
      string,
      string,
      { mcpServers: Record<string, unknown> },
    ];
    expect(Object.keys(createArgs[2].mcpServers)).not.toContain('gmail-personal');

    const persisted = new AgentSessionsRepository().findById(created.id);
    expect(persisted?.mcpRole).toBe('secretary');
    expect(persisted?.mcpAllowedToolsJson).toBe(expectedAllowedMcpsJson);
  });
});
