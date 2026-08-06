import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { getDb, setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { AgentSessionMessagesRepository } from '../repositories/agent_session_messages_repository';
import { AgentAsyncDelegationsRepository } from '../repositories/agent_async_delegations_repository';

const { engineSpies, sessionMap, streamSessionSpy } = vi.hoisted(() => ({
  engineSpies: {
    createSession: vi.fn(),
    listMessages: vi.fn(),
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
    ownerUserId: 42,
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
    getDb()
      .prepare("INSERT INTO users (id, name, email) VALUES (42, 'Test User', 'issue-1123@example.com')")
      .run();
    sessionMap.clear();
    vi.clearAllMocks();
    engineSpies.createSession.mockResolvedValue({ id: 'sdk-child-1' });
    engineSpies.listMessages.mockResolvedValue([]);
    engineSpies.promptAsync.mockResolvedValue(true);
    streamSessionSpy.mockResolvedValue(undefined);
  });

  it('issue-1123-c1: async dispatch persists a parent-linked child, subscribes before promptAsync, and returns immediately', async () => {
    seedProfile({ id: 'manager', manager: true, delegates: ['specialist'] });
    seedProfile({ id: 'specialist' });
    const parent = seedSession({ agentKind: 'manager', sdkId: 'sdk-parent' });

    const result = await delegateToAgentAsync({
      authenticatedUserId: 42,
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
        authenticatedUserId: 42,
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

  it('issue-1175-c9: restart recovery recognizes an accepted deterministic wake and never prompts twice', async () => {
    seedProfile({ id: 'manager', manager: true, delegates: ['specialist'] });
    seedProfile({ id: 'specialist' });
    const parent = seedSession({ agentKind: 'manager', sdkId: 'sdk-parent' });
    const child = new AgentSessionsRepository().upsertChildSession(
      'sdk-child',
      'sdk-parent',
      'Async child (@specialist subagent)',
      '/tmp',
    )!;
    const delegations = new AgentAsyncDelegationsRepository();
    delegations.create({
      parentSessionId: parent.id,
      childSessionId: child.id,
      targetAgentConfigId: 'specialist',
    });
    new AgentSessionMessagesRepository().append(
      child.id,
      'output',
      'durable specialist result',
      'durable specialist result',
    );

    await new AsyncDelegationCompletionService().onChildIdle(child.id);
    const promptOptions = engineSpies.promptAsync.mock.calls[0][4] as {
      messageID?: string;
    };
    const wakeText = String(engineSpies.promptAsync.mock.calls[0][1]);

    // The wake must NOT carry a fabricated message id. Engine ids are
    // `msg_` + 12 HEX chars encoding a timestamp, and the engine orders a
    // session's messages by that decoded value. `msg_rhythm_async_<sha256>` is
    // undecodable, so the wake had no position in time and the engine re-invoked
    // the model forever (56 assistant turns, observed 2026-08-05). Recovery keys
    // on the deterministic MARKER in the text instead, which is what makes this
    // idempotent.
    expect(promptOptions.messageID).toBeUndefined();
    expect(wakeText).toMatch(/<!-- rhythm-async-delegation:msg_rhythm_async_[0-9a-f]{24} -->/);

    // Simulate the only ambiguous crash window: OpenCode accepted/persisted the
    // deterministic user message, but api_server died before its notified write.
    getDb()
      .prepare(
        `UPDATE agent_async_delegations
            SET status = 'waking', notified_at = NULL
          WHERE child_session_id = ?`,
      )
      .run(child.id);
    engineSpies.promptAsync.mockClear();
    engineSpies.listMessages.mockResolvedValue([
      {
        // A realistic engine-assigned id (12 hex + base62) — recovery must
        // recognise the wake from the marker in the text, not from id equality.
        info: { id: 'msg_fd3811aaaa01Zq7TmLr4Wc9Xb' },
        parts: [{ type: 'text', text: wakeText }],
      },
    ]);

    const recovery = new AsyncDelegationCompletionService();
    const result = await recovery.recoverAfterRestart();

    expect(result).toEqual({ parentsExamined: 1, claimsRemaining: 0 });
    expect(engineSpies.listMessages).toHaveBeenCalledWith(
      'sdk-parent',
      '/tmp',
    );
    expect(engineSpies.promptAsync).not.toHaveBeenCalled();
    expect(delegations.findByChildSessionId(child.id)?.status).toBe('notified');
  });

  it('issue-1175-c9: a successful wake releases the process gate for the next completion batch', async () => {
    seedProfile({ id: 'manager', manager: true, delegates: ['specialist'] });
    seedProfile({ id: 'specialist' });
    const parent = seedSession({ agentKind: 'manager', sdkId: 'sdk-parent' });
    const sessions = new AgentSessionsRepository();
    const delegations = new AgentAsyncDelegationsRepository();
    const messages = new AgentSessionMessagesRepository();
    const completion = new AsyncDelegationCompletionService();

    for (const suffix of ['first', 'second']) {
      const child = sessions.upsertChildSession(
        `sdk-child-${suffix}`,
        'sdk-parent',
        `Async child ${suffix} (@specialist subagent)`,
        '/tmp',
      )!;
      delegations.create({
        parentSessionId: parent.id,
        childSessionId: child.id,
        targetAgentConfigId: 'specialist',
      });
      messages.append(
        child.id,
        'output',
        `${suffix} durable result`,
        `${suffix} durable result`,
      );
      await completion.onChildIdle(child.id);
    }

    expect(engineSpies.promptAsync).toHaveBeenCalledTimes(2);
    expect(String(engineSpies.promptAsync.mock.calls[0][1])).toContain(
      'first durable result',
    );
    expect(String(engineSpies.promptAsync.mock.calls[1][1])).toContain(
      'second durable result',
    );
  });

  it('issue-1175-c9: restart recovery paginates beyond the first bounded parent page', async () => {
    seedProfile({ id: 'manager', manager: true, delegates: ['specialist'] });
    seedProfile({ id: 'specialist' });
    const sessions = new AgentSessionsRepository();
    const delegations = new AgentAsyncDelegationsRepository();
    const messages = new AgentSessionMessagesRepository();

    for (let index = 0; index < 101; index += 1) {
      const parent = seedSession({
        agentKind: 'manager',
        sdkId: `sdk-parent-${index.toString().padStart(3, '0')}`,
      });
      const child = sessions.upsertChildSession(
        `sdk-child-${index.toString().padStart(3, '0')}`,
        parent.sdkSessionId!,
        `Async child ${index} (@specialist subagent)`,
        '/tmp',
      )!;
      delegations.create({
        parentSessionId: parent.id,
        childSessionId: child.id,
        targetAgentConfigId: 'specialist',
      });
      messages.append(child.id, 'output', `result ${index}`, `result ${index}`);
      getDb()
        .prepare(
          `UPDATE agent_async_delegations
              SET status = 'waking'
            WHERE child_session_id = ?`,
        )
        .run(child.id);
    }

    const result = await new AsyncDelegationCompletionService().recoverAfterRestart(
      25,
    );

    expect(result).toEqual({ parentsExamined: 101, claimsRemaining: 0 });
    expect(engineSpies.promptAsync).toHaveBeenCalledTimes(101);
    expect(delegations.countWakingClaims()).toBe(0);
  });
});
