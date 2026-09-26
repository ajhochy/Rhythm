import Database from 'better-sqlite3';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { errorHandler } from '../middleware/error_handler';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';

const { broadcastSpy, listPermissionsSpy, replyToPermissionSpy, sessionMap } = vi.hoisted(() => {
  process.env.AGENT_LOCAL = 'true';
  return {
    broadcastSpy: vi.fn(),
    listPermissionsSpy: vi.fn().mockResolvedValue([]),
    replyToPermissionSpy: vi.fn().mockResolvedValue(true),
    sessionMap: new Map<string, string>(),
  };
});

vi.mock('../services/ws_gateway', () => ({
  broadcast: broadcastSpy,
  broadcastSessionUpdated: vi.fn(),
  broadcastSessionRemoved: vi.fn(),
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    abortSession: vi.fn().mockResolvedValue(true),
    listPermissions: listPermissionsSpy,
    replyToPermission: replyToPermissionSpy,
  },
  opencodeSessionMap: sessionMap,
}));

vi.mock('../services/skill_extractor', () => ({ queueSkillExtraction: vi.fn() }));

import { agentSessionsRouter } from '../routes/agent_sessions_routes';
import { OpencodeStreamBridge, streamBridge } from '../services/opencode_stream_bridge';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

function relay(
  bridge: OpencodeStreamBridge,
  sdkSessionId: string,
  permissionId: string,
  toolName: string,
  options: { patterns?: string[]; title?: string } = {},
): void {
  (bridge as unknown as { _relayEvent(event: unknown): void })._relayEvent({
    type: 'permission.asked',
    properties: {
      permissionID: permissionId,
      sessionID: sdkSessionId,
      toolName,
      summary: options.title ?? toolName,
      title: options.title,
      patterns: options.patterns ?? [],
      args: {},
    },
  });
}

describe('#1382-E — bridge permission cleanup', () => {
  beforeEach(() => {
    setDb(makeDb());
    sessionMap.clear();
    broadcastSpy.mockClear();
    listPermissionsSpy.mockReset().mockResolvedValue([]);
    replyToPermissionSpy.mockReset().mockResolvedValue(true);
  });

  it('1382:E:1 stopStream clears pending and replied keys and recovery cannot resurface them', async () => {
    const bridge = new OpencodeStreamBridge();
    const repo = new AgentSessionsRepository();
    const session = repo.insert({
      agentKind: 'claude-code',
      taskId: null,
      cwd: '/tmp/cleanup-1382',
      name: 'cleanup',
    });
    repo.setSdkSessionId(session.id, 'sdk-cleanup');
    sessionMap.set(session.id, 'sdk-cleanup');

    relay(bridge, 'sdk-cleanup', 'perm-replied', 'read');
    bridge.markPermissionReplied(session.id, 'perm-replied');
    relay(bridge, 'sdk-cleanup', 'perm-pending', 'read');
    expect(bridge.getPendingPermission(session.id, 'perm-pending')).toBeDefined();

    bridge.stopStream(session.id);

    expect(bridge.getPendingPermission(session.id, 'perm-pending')).toBeUndefined();
    broadcastSpy.mockClear();
    bridge.markPermissionReplied(session.id, 'perm-replied');
    expect(broadcastSpy).toHaveBeenCalledTimes(1);

    broadcastSpy.mockClear();
    listPermissionsSpy.mockResolvedValue([
      { id: 'perm-pending', sessionID: 'sdk-cleanup', permission: 'read' },
    ]);
    await bridge.recoverPendingPermissions('/tmp/cleanup-1382');
    expect(broadcastSpy).not.toHaveBeenCalled();
    expect(replyToPermissionSpy).not.toHaveBeenCalled();

    const bypassSession = repo.insert({
      agentKind: 'claude-code',
      taskId: null,
      cwd: '/tmp/cleanup-1382',
      name: 'stopped bypass cleanup',
      permissionMode: 'bypassPermissions',
    });
    repo.setSdkSessionId(bypassSession.id, 'sdk-stopped-bypass');
    sessionMap.set(bypassSession.id, 'sdk-stopped-bypass');
    bridge.stopStream(bypassSession.id);
    listPermissionsSpy.mockResolvedValue([
      { id: 'perm-stopped-bypass', sessionID: 'sdk-stopped-bypass', permission: 'edit' },
    ]);

    await bridge.recoverPendingPermissions('/tmp/cleanup-1382');

    expect(replyToPermissionSpy).not.toHaveBeenCalled();
    expect(broadcastSpy).not.toHaveBeenCalled();
    bridge.dispose();
  });
});

describe('#1382-E — legacy permission route uses canonical reply cleanup', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use('/agent-sessions', agentSessionsRouter);
    app.use(errorHandler);
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', resolve);
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    setDb(makeDb());
    streamBridge.dispose();
    sessionMap.clear();
    broadcastSpy.mockClear();
    replyToPermissionSpy.mockReset().mockResolvedValue(true);
  });

  it('1382:E:2 preserves pending metadata and dedups a later canonical reply', async () => {
    const repo = new AgentSessionsRepository();
    const session = repo.insert({
      agentKind: 'claude-code',
      taskId: null,
      cwd: '/tmp/legacy-1382',
      name: 'legacy reply',
    });
    repo.setSdkSessionId(session.id, 'sdk-legacy');
    sessionMap.set(session.id, 'sdk-legacy');
    relay(streamBridge, 'sdk-legacy', 'perm-legacy', 'bash', {
      patterns: ['git status'],
      title: 'Allow git status?',
    });
    broadcastSpy.mockClear();

    const legacy = await fetch(
      `${baseUrl}/agent-sessions/${session.id}/permission/perm-legacy/allow`,
      { method: 'POST' },
    );
    expect(legacy.status).toBe(204);

    const replyFrames = () => broadcastSpy.mock.calls
      .map((call) => call[0] as Record<string, unknown>)
      .filter((frame) => frame.type === 'permission.replied');
    expect(replyFrames()).toEqual([
      expect.objectContaining({
        sessionId: session.id,
        permissionID: 'perm-legacy',
        directory: '/tmp/legacy-1382',
        tool: 'bash',
        patterns: ['git status'],
        title: 'Allow git status?',
      }),
    ]);

    const canonical = await fetch(
      `${baseUrl}/agent-sessions/${session.id}/permissions/perm-legacy/reply`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reply: 'once' }),
      },
    );
    expect(canonical.status).toBe(204);
    expect(replyFrames()).toHaveLength(1);
  });
});
