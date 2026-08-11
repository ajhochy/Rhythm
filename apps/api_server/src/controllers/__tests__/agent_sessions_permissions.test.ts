import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import type { NextFunction, Request, Response } from 'express';
import { runMigrations } from '../../database/migrations';
import { setDb } from '../../database/db';
import { AgentSessionsRepository } from '../../repositories/agent_sessions_repository';

const { listPermissions, replyToPermission, markPermissionReplied } = vi.hoisted(() => ({
  listPermissions: vi.fn(),
  replyToPermission: vi.fn(),
  markPermissionReplied: vi.fn(),
}));

vi.mock('../../services/opencode_engine', () => ({
  opencodeClient: { listPermissions, replyToPermission },
  opencodeSessionMap: new Map<string, string>(),
}));

vi.mock('../../services/opencode_stream_bridge', () => ({
  streamBridge: { markPermissionReplied },
}));

vi.mock('../../services/ws_gateway', () => ({
  broadcast: vi.fn(),
  broadcastSessionUpdated: vi.fn(),
  broadcastSessionRemoved: vi.fn(),
}));

vi.mock('../../services/agent_profile_sync', () => ({
  syncOpencodeAgentProfiles: vi.fn(),
}));

import { AgentSessionsController } from '../agent_sessions_controller';

function makeResponse() {
  const state: { statusCode: number; body: unknown; ended: boolean } = {
    statusCode: 200,
    body: null,
    ended: false,
  };
  const res = {
    status(code: number) {
      state.statusCode = code;
      return this;
    },
    json(body: unknown) {
      state.body = body;
      return this;
    },
    end() {
      state.ended = true;
      return this;
    },
  } as unknown as Response;
  return { res, state };
}

describe('AgentSessionsController — issue #1340 permission REST fallback', () => {
  let controller: AgentSessionsController;
  let sessionId: string;
  let nextError: unknown;
  let next: NextFunction;

  beforeEach(() => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);
    const repo = new AgentSessionsRepository();
    const session = repo.insert({
      agentKind: 'claude-code',
      taskId: null,
      cwd: '/workspace/project',
      name: 'permission contract',
    });
    repo.setSdkSessionId(session.id, 'sdk-contract');
    sessionId = session.id;
    controller = new AgentSessionsController();
    nextError = undefined;
    next = ((error?: unknown) => { nextError = error; }) as NextFunction;
    listPermissions.mockReset();
    replyToPermission.mockReset();
    markPermissionReplied.mockReset();
  });

  it('issue-1340-c2: GET proxies the engine in the session directory and filters by SDK session', async () => {
    listPermissions.mockResolvedValue([
      {
        id: 'perm-mine',
        sessionID: 'sdk-contract',
        permission: 'bash',
        patterns: ['git push'],
        title: 'Allow push?',
      },
      { id: 'perm-other', sessionID: 'sdk-other', permission: 'edit', patterns: ['*'] },
    ]);
    const { res, state } = makeResponse();
    await controller.listPendingPermissions(
      { params: { id: sessionId } } as unknown as Request,
      res,
      next,
    );

    expect(nextError).toBeUndefined();
    expect(listPermissions).toHaveBeenCalledWith('/workspace/project');
    expect(state.body).toEqual([
      {
        sessionId,
        permissionID: 'perm-mine',
        directory: '/workspace/project',
        tool: 'bash',
        patterns: ['git push'],
        title: 'Allow push?',
        createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
      },
    ]);
  });

  it('issue-1340-c3: POST replies with the persisted directory and SDK session', async () => {
    replyToPermission.mockResolvedValue(true);
    const { res, state } = makeResponse();
    await controller.replyPermission(
      {
        params: { id: sessionId, permissionID: 'perm-mine' },
        body: { reply: 'always' },
      } as unknown as Request,
      res,
      next,
    );

    expect(nextError).toBeUndefined();
    expect(replyToPermission).toHaveBeenCalledWith(
      'perm-mine',
      'always',
      undefined,
      '/workspace/project',
      'sdk-contract',
    );
    expect(markPermissionReplied).toHaveBeenCalledWith(sessionId, 'perm-mine');
    expect(state.statusCode).toBe(204);
    expect(state.ended).toBe(true);
  });

  it('issue-1340-c4: POST returns 404 and preserves pending state when the engine matches nothing', async () => {
    replyToPermission.mockResolvedValue(false);
    const { res } = makeResponse();
    await controller.replyPermission(
      {
        params: { id: sessionId, permissionID: 'perm-missing' },
        body: { reply: 'once' },
      } as unknown as Request,
      res,
      next,
    );

    expect(nextError).toMatchObject({ statusCode: 404 });
    expect(markPermissionReplied).not.toHaveBeenCalled();
  });
});
