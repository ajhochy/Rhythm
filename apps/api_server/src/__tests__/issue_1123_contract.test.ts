import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { AgentSessionMessagesRepository } from '../repositories/agent_session_messages_repository';
import { AgentAsyncDelegationsRepository } from '../repositories/agent_async_delegations_repository';

const { engineSpies, sessionMap, streamSessionSpy } = vi.hoisted(() => ({
  engineSpies: {
    createSession: vi.fn(),
    promptAsync: vi.fn(),
  },
  sessionMap: new Map<string, string>(),
  streamSessionSpy: vi.fn(),
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: engineSpies,
  opencodeSessionMap: sessionMap,
}));

vi.mock('../services/opencode_stream_bridge', () => ({
  streamBridge: {
    streamSession: streamSessionSpy,
  },
}));

import { delegateToAgentAsync } from '../services/agent_delegation_service';
import { AsyncDelegationCompletionService } from '../services/async_delegation_completion_service';

function makeDb(): void {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
}

function seedProfile(input: {
  id: string;
  manager?: boolean;
  selectable?: boolean;
  delegates?: string[];
}): void {
  new AgentConfigsRepository().insert({
    id: input.id,
    label: input.id,
    icon: 'agent',
    enabled: true,
    isAgent: true,
    isManager: input.manager ?? false,
    sessionSelectable: input.selectable ?? true,
    allowedDelegatesJson: input.delegates ? JSON.stringify(input.delegates) : null,
    modelProvider: 'google',
    modelId: 'gemini-2.5-pro',
    ocAgent: input.id,
    corePermissionsJson: JSON.stringify({ rhythm_delegate_async: 'allow' }),
  });
}

function seedSession(input: {
  agentKind: string;
  sdkId: string;
  system?: boolean;
  scheduledTaskId?: string | null;
  category?: 'chat' | 'scheduled';
}): ReturnType<AgentSessionsRepository['insert']> {
  const repo = new AgentSessionsRepository();
  const session = repo.insert({
    agentKind: input.agentKind as never,
    taskId: null,
    taskTitle: null,
    cwd: '/tmp',
    name: input.agentKind,
    mcpRole: input.agentKind,
    isSystem: input.system ?? false,
    scheduledTaskId: input.scheduledTaskId ?? null,
    category: input.category,
  });
  repo.setSdkSessionId(session.id, input.sdkId);
  repo.updateStatus(session.id, 'idle');
  sessionMap.set(session.id, input.sdkId);
  return repo.findById(session.id)!;
}

describe('issue #1123 — asynchronous interactive delegation contract', () => {
  beforeEach(() => {
    makeDb();
    sessionMap.clear();
    vi.clearAllMocks();
    engineSpies.createSession.mockResolvedValue({ id: 'sdk-child-1' });
    engineSpies.promptAsync.mockResolvedValue(true);
    streamSessionSpy.mockResolvedValue(undefined);
  });

  it('issue-1123-c1: async dispatch persists a parent-linked child, subscribes before promptAsync, and returns immediately', async () => {
    seedProfile({ id: 'manager', manager: true, delegates: ['specialist'] });
    seedProfile({ id: 'specialist' });
    const parent = seedSession({ agentKind: 'manager', sdkId: 'sdk-parent' });

    const result = await delegateToAgentAsync({
      callerSessionId: parent.id,
      targetAgentConfigId: 'specialist',
      prompt: 'Produce the specialist result.',
    });

    expect(result).toMatchObject({
      status: 'dispatched',
      targetAgentConfigId: 'specialist',
      message: expect.stringContaining("you'll be notified"),
    });
    const child = new AgentSessionsRepository().findById(result.sessionId);
    expect(child).toMatchObject({
      parentSessionId: parent.id,
      sdkSessionId: 'sdk-child-1',
      agentKind: 'specialist',
    });
    expect(engineSpies.createSession).toHaveBeenCalledWith(
      expect.stringContaining('@specialist subagent'),
      '/tmp',
      undefined,
      undefined,
      'google',
      'sdk-parent',
    );
    expect(streamSessionSpy).toHaveBeenCalledWith(result.sessionId, 'sdk-child-1', '/tmp');
    expect(streamSessionSpy.mock.invocationCallOrder[0])
      .toBeLessThan(engineSpies.promptAsync.mock.invocationCallOrder[0]);
    expect(engineSpies.promptAsync).toHaveBeenCalledWith(
      'sdk-child-1',
      'Produce the specialist result.',
      { providerID: 'google', modelID: 'gemini-2.5-pro' },
      '/tmp',
      expect.objectContaining({ agent: 'specialist', permissionMode: 'bypassPermissions' }),
    );
    expect(
      new AgentAsyncDelegationsRepository().findByChildSessionId(result.sessionId),
    ).toMatchObject({ status: 'dispatched', parentSessionId: parent.id });
  });

  it('issue-1123-c4: async delegation rejects system, scheduled, and non-interactive caller profiles', async () => {
    seedProfile({ id: 'manager', manager: true, delegates: ['specialist'] });
    seedProfile({
      id: 'hidden-manager',
      manager: true,
      selectable: false,
      delegates: ['specialist'],
    });
    seedProfile({ id: 'specialist' });

    const system = seedSession({ agentKind: 'manager', sdkId: 'sdk-system', system: true });
    const scheduled = seedSession({
      agentKind: 'manager',
      sdkId: 'sdk-scheduled',
      category: 'scheduled',
    });
    const hidden = seedSession({ agentKind: 'hidden-manager', sdkId: 'sdk-hidden' });

    for (const callerSessionId of [system.id, scheduled.id, hidden.id]) {
      await expect(delegateToAgentAsync({
        callerSessionId,
        targetAgentConfigId: 'specialist',
        prompt: 'This must not dispatch.',
      })).rejects.toMatchObject({ statusCode: 403 });
    }
    expect(engineSpies.createSession).not.toHaveBeenCalled();
    expect(engineSpies.promptAsync).not.toHaveBeenCalled();
  });

  it('issue-1123-c3: busy parents defer wakes and concurrent child results are coalesced exactly once', async () => {
    seedProfile({ id: 'manager', manager: true, delegates: ['specialist-a', 'specialist-b'] });
    seedProfile({ id: 'specialist-a' });
    seedProfile({ id: 'specialist-b' });
    const parent = seedSession({ agentKind: 'manager', sdkId: 'sdk-parent' });
    const sessionRepo = new AgentSessionsRepository();
    const delegationRepo = new AgentAsyncDelegationsRepository();
    const messagesRepo = new AgentSessionMessagesRepository();

    const childA = sessionRepo.upsertChildSession(
      'sdk-child-a',
      'sdk-parent',
      'Async A (@specialist-a subagent)',
      '/tmp',
    )!;
    const childB = sessionRepo.upsertChildSession(
      'sdk-child-b',
      'sdk-parent',
      'Async B (@specialist-b subagent)',
      '/tmp',
    )!;
    delegationRepo.create({
      parentSessionId: parent.id,
      childSessionId: childA.id,
      targetAgentConfigId: 'specialist-a',
    });
    delegationRepo.create({
      parentSessionId: parent.id,
      childSessionId: childB.id,
      targetAgentConfigId: 'specialist-b',
    });
    messagesRepo.append(childA.id, 'output', 'alpha result', 'alpha result');
    messagesRepo.append(childB.id, 'output', 'beta result', 'beta result');

    const completion = new AsyncDelegationCompletionService();
    sessionRepo.updateStatus(parent.id, 'working');
    await Promise.all([
      completion.onChildIdle(childA.id),
      completion.onChildIdle(childB.id),
      completion.onChildIdle(childA.id),
    ]);
    expect(engineSpies.promptAsync).not.toHaveBeenCalled();

    sessionRepo.updateStatus(parent.id, 'idle');
    await completion.onParentIdle(parent.id);

    expect(engineSpies.promptAsync).toHaveBeenCalledTimes(1);
    const wakeText = String(engineSpies.promptAsync.mock.calls[0][1]);
    expect(wakeText).toContain('alpha result');
    expect(wakeText).toContain('beta result');
    expect(wakeText).toContain(childA.id);
    expect(wakeText).toContain(childB.id);
    expect(delegationRepo.findByChildSessionId(childA.id)?.status).toBe('notified');
    expect(delegationRepo.findByChildSessionId(childB.id)?.status).toBe('notified');

    await completion.onChildIdle(childA.id);
    await completion.onParentIdle(parent.id);
    expect(engineSpies.promptAsync).toHaveBeenCalledTimes(1);
  });

  it('issue-1123-c5: wake uses the existing parent prompt and transcript surfaces with no bespoke frame', async () => {
    seedProfile({ id: 'manager', manager: true, delegates: ['specialist'] });
    seedProfile({ id: 'specialist' });
    const parent = seedSession({ agentKind: 'manager', sdkId: 'sdk-parent' });
    const child = new AgentSessionsRepository().upsertChildSession(
      'sdk-child',
      'sdk-parent',
      'Async child (@specialist subagent)',
      '/tmp',
    )!;
    new AgentAsyncDelegationsRepository().create({
      parentSessionId: parent.id,
      childSessionId: child.id,
      targetAgentConfigId: 'specialist',
    });
    new AgentSessionMessagesRepository().append(
      child.id,
      'output',
      'specialist finished',
      'specialist finished',
    );

    await new AsyncDelegationCompletionService().onChildIdle(child.id);

    expect(engineSpies.promptAsync).toHaveBeenCalledWith(
      'sdk-parent',
      expect.stringContaining('specialist finished'),
      expect.anything(),
      '/tmp',
      expect.not.objectContaining({ noReply: true }),
    );
  });
});
