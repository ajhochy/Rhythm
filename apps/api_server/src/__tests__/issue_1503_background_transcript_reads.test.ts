import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { SessionsRepository } from '../repositories/sessions_repository';
import { UsersRepository } from '../repositories/users_repository';
import { authorizeMobileOpenCodeOperation } from '../services/mobile_opencode_security';
import { startTestServer } from './helpers/real_server';

const listMessages = vi.fn();

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    listMessages: (...args: unknown[]) => listMessages(...args),
  },
  opencodeSessionMap: new Map<string, string>(),
}));

describe('#1503 background transcript reads', () => {
  let close: (() => Promise<void>) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);
  });

  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  it('1503-C-bound-background-transcript-readers:1 bounds model backfill and uses the latest assistant model', async () => {
    const user = new UsersRepository().create({ name: '1503', email: '1503@example.test' });
    const auth = await new SessionsRepository().createAsync(user.id);
    const repo = new AgentSessionsRepository();
    const session = repo.insert({
      agentKind: 'claude-code',
      profileId: null,
      opencodeAgentId: null,
      taskId: null,
      taskTitle: null,
      cwd: '/synthetic/project',
      name: 'Background reader',
      projectId: null,
      mcpRole: null,
      mcpAllowedToolsJson: null,
      scheduledTaskId: null,
      ownerUserId: user.id,
      parentSessionId: null,
      delegationDepth: 0,
      category: 'chat',
    });
    repo.setSdkSessionId(session.id, 'sdk-model-backfill');
    listMessages.mockResolvedValue([
      { info: { id: 'older', role: 'assistant', providerID: 'old-provider', modelID: 'old-model' }, parts: [] },
      { info: { id: 'user', role: 'user' }, parts: [] },
      { info: { id: 'latest', role: 'assistant', providerID: 'new-provider', modelID: 'new-model' }, parts: [] },
    ]);
    const started = await startTestServer((await import('../app')).createApp());
    close = started.close;

    const response = await fetch(`${started.baseUrl}/agent-sessions/${session.id}`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    expect(response.status).toBe(200);
    for (let attempt = 0; attempt < 50 && repo.findById(session.id)?.modelId !== 'new-model'; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    expect(listMessages).toHaveBeenCalledWith(
      'sdk-model-backfill',
      undefined,
      { limit: 20, caller: 'agent_sessions.model_backfill' },
    );
    expect(repo.findById(session.id)).toMatchObject({
      providerId: 'new-provider',
      modelId: 'new-model',
    });
  }, 30_000);

  it('1503-C-bound-background-transcript-readers:2 authorizes a part through only the single-message endpoint', async () => {
    const calls: string[] = [];
    const fetchJson = vi.fn(async (path: string) => {
      calls.push(path);
      return {
        info: { id: 'message-a', sessionID: 'session-a', role: 'assistant' },
        parts: [{ id: 'part-a', type: 'text', text: 'safe' }],
      };
    });
    const operation = {
      operationId: 'part.update',
      method: 'PATCH',
      path: '/session/{sessionID}/message/{messageID}/part/{partID}',
      allowed: true,
    };
    const owner = {
      ownerUserId: 1,
      ownership: { isResourceOwnedBy: () => true },
    };

    await authorizeMobileOpenCodeOperation(
      operation,
      '/session/session-a/message/message-a/part/part-a',
      { id: 'project-a', root: '/synthetic/project' },
      fetchJson,
      undefined,
      undefined,
      owner,
      { sessionIds: new Set(['session-a']) },
    );

    expect(calls).toEqual(['/session/session-a/message/message-a']);
  });

  it('1503-C-bound-background-transcript-readers:3 rejects cross-session messages and missing parts', async () => {
    const operation = {
      operationId: 'part.delete',
      method: 'DELETE',
      path: '/session/{sessionID}/message/{messageID}/part/{partID}',
      allowed: true,
    };
    const owner = {
      ownerUserId: 1,
      ownership: { isResourceOwnedBy: () => true },
    };
    const authorize = (payload: unknown) => authorizeMobileOpenCodeOperation(
      operation,
      '/session/session-a/message/message-a/part/part-a',
      { id: 'project-a', root: '/synthetic/project' },
      vi.fn().mockResolvedValue(payload),
      undefined,
      undefined,
      owner,
      { sessionIds: new Set(['session-a']) },
    );

    await expect(authorize({
      info: { id: 'message-a', sessionID: 'session-b' },
      parts: [{ id: 'part-a' }],
    })).rejects.toMatchObject({ statusCode: 404 });
    await expect(authorize({
      info: { id: 'message-a', sessionID: 'session-a' },
      parts: [{ id: 'other-part' }],
    })).rejects.toMatchObject({ statusCode: 404 });
  });
});
