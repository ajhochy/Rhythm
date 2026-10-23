import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { getDb, setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';

const { engine, sessionMap, streamSession } = vi.hoisted(() => ({
  engine: {
    createSession: vi.fn(),
    createWorktree: vi.fn(),
    listAuthedProviders: vi.fn(),
    listModels: vi.fn(),
    listProviders: vi.fn(),
    promptAsync: vi.fn(),
    removeWorktree: vi.fn(),
  },
  sessionMap: new Map<string, string>(),
  streamSession: vi.fn(),
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: engine,
  opencodeSessionMap: sessionMap,
}));
vi.mock('../services/opencode_stream_bridge', () => ({
  streamBridge: { streamSession },
}));

import { delegateToAgentAsync } from '../services/agent_delegation_service';
import { AgentAsyncDelegationsRepository } from '../repositories/agent_async_delegations_repository';
import { OpencodeClientService } from '../services/opencode_client_service';
import type { PermissionMode } from '../models/agent_session';

function seedProfile(id: string, manager = false): void {
  new AgentConfigsRepository().insert({
    id,
    label: id,
    icon: 'agent',
    enabled: true,
    isAgent: true,
    isManager: manager,
    sessionSelectable: true,
    allowedDelegatesJson: manager ? JSON.stringify(['specialist']) : null,
    modelProvider: 'google',
    modelId: 'gemini-2.5-pro',
    ocAgent: id,
    corePermissionsJson: JSON.stringify({ rhythm_delegate_async: 'allow' }),
  });
}

function seedParent(): ReturnType<AgentSessionsRepository['findById']> {
  const repo = new AgentSessionsRepository();
  const parent = repo.insert({
    agentKind: 'manager' as never,
    taskId: null,
    cwd: '/repo/manager',
    name: 'manager',
    mcpRole: 'manager',
    ownerUserId: 42,
  });
  repo.setSdkSessionId(parent.id, 'sdk-parent');
  return repo.findById(parent.id);
}

describe('interactive async delegation preserves permission scope', () => {
  let nativeBody: Record<string, unknown> | undefined;
  beforeEach(() => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);
    getDb().prepare("INSERT INTO users (id,name,email) VALUES (42,'Test','async-permission@example.com')").run();
    sessionMap.clear();
    vi.clearAllMocks();
    nativeBody = undefined;
    const native = new OpencodeClientService();
    (native as unknown as { client: unknown }).client = { session: { create: async (request: { body: Record<string, unknown> }) => {
      nativeBody = request.body;
      return { data: { id: 'sdk-child' } };
    } } };
    engine.createSession.mockImplementation(native.createSession.bind(native));
    engine.promptAsync.mockResolvedValue(true);
    engine.listProviders.mockResolvedValue([]);
    streamSession.mockResolvedValue(undefined);
    seedProfile('manager', true);
    seedProfile('specialist');
  });

  const delegate = (id: string) => delegateToAgentAsync({ authenticatedUserId: 42,
    callerSessionId: id, targetAgentConfigId: 'specialist', prompt: 'Read the supplied plan.' });

  it.each<PermissionMode>(['default', 'plan', 'acceptEdits'])('keeps %s mode in durable child and actual engine create body', async (mode) => {
    const parent = seedParent()!;
    const repo = new AgentSessionsRepository();
    repo.updatePermissionMode(parent.id, mode);
    const result = await delegate(parent.id);
    expect(repo.findById(result.sessionId)?.permissionMode).toBe(mode);
    expect(repo.findById(parent.id)?.permissionMode).toBe(mode);
    expect(engine.promptAsync.mock.calls[0][4]).toMatchObject({ permissionMode: mode, agent: 'specialist' });
    const rules = nativeBody?.permission as Array<{permission:string;pattern:string;action:string}>;
    expect(rules).not.toContainEqual({ permission: '*', pattern: '*', action: 'allow' });
    if (mode === 'plan') expect(rules).toContainEqual({ permission: 'bash', pattern: '*', action: 'deny' });
    else expect(rules).not.toContainEqual({ permission: 'bash', pattern: '*', action: 'deny' });
  });

  it('retains an explicitly selected parent bypass mode without creating it for ordinary parents', async () => {
    const parent = seedParent()!;
    const repo = new AgentSessionsRepository();
    repo.updatePermissionMode(parent.id, 'bypassPermissions');
    const result = await delegate(parent.id);
    expect(repo.findById(result.sessionId)?.permissionMode).toBe('bypassPermissions');
    expect(nativeBody?.permission).toContainEqual({ permission: '*', pattern: '*', action: 'allow' });
  });

  it('refuses dispatch if permission mode changes while creating the child', async () => {
    const parent = seedParent()!;
    engine.createSession.mockImplementationOnce(async () => {
      new AgentSessionsRepository().updatePermissionMode(parent.id, 'plan');
      return { id: 'sdk-child' };
    });
    await expect(delegate(parent.id)).rejects.toThrow(/permission.*changed/i);
    expect(engine.promptAsync).not.toHaveBeenCalled();
  });

  it('records a held dispatch if the parent changes mode during stream subscription', async () => {
    const parent = seedParent()!;
    streamSession.mockImplementationOnce(async () => {
      new AgentSessionsRepository().updatePermissionMode(parent.id, 'plan');
    });
    await expect(delegate(parent.id)).rejects.toThrow(/permission.*changed/i);
    expect(engine.promptAsync).not.toHaveBeenCalled();
    const child = new AgentSessionsRepository().findBySdkSessionId('sdk-child')!;
    expect(child.permissionMode).toBe('default');
    expect(new AgentAsyncDelegationsRepository().findByChildSessionId(child.id)?.status).toBe('failed');
  });
});
