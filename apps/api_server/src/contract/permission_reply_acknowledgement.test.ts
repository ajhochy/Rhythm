import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';

const { broadcastSpy, listPermissionsSpy, replyToPermissionSpy, sessionMap } = vi.hoisted(() => ({
  broadcastSpy: vi.fn(),
  listPermissionsSpy: vi.fn(),
  replyToPermissionSpy: vi.fn(),
  sessionMap: new Map<string, string>(),
}));

vi.mock('../services/ws_gateway', () => ({
  broadcast: broadcastSpy,
  broadcastSessionUpdated: vi.fn(),
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    listPermissions: listPermissionsSpy,
    replyToPermission: replyToPermissionSpy,
  },
  opencodeSessionMap: sessionMap,
}));

vi.mock('../services/skill_extractor', () => ({ queueSkillExtraction: vi.fn() }));

import { OpencodeStreamBridge } from '../services/opencode_stream_bridge';

type Permission = {
  id: string;
  sessionID: string;
  permission: string;
  patterns?: string[];
};

function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('automatic permission reply acknowledgement', () => {
  let db: Database.Database;
  let bridge: OpencodeStreamBridge;
  let repo: AgentSessionsRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);
    repo = new AgentSessionsRepository();
    bridge = new OpencodeStreamBridge();
    sessionMap.clear();
    broadcastSpy.mockClear();
    listPermissionsSpy.mockReset().mockResolvedValue([]);
    replyToPermissionSpy.mockReset().mockResolvedValue(true);
  });

  afterEach(() => {
    bridge.dispose();
    db.close();
    vi.clearAllMocks();
  });

  function seed(permissionMode: 'bypassPermissions' | 'plan'): { localId: string; sdkId: string } {
    const sdkId = `sdk-${permissionMode}`;
    const row = repo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: '/tmp/permission-ack',
      name: sdkId,
      permissionMode,
    });
    repo.setSdkSessionId(row.id, sdkId);
    sessionMap.set(row.id, sdkId);
    return { localId: row.id, sdkId };
  }

  function resolvedFrames(): Array<Record<string, unknown>> {
    return broadcastSpy.mock.calls
      .map(([frame]) => frame as Record<string, unknown>)
      .filter((frame) => frame.type === 'permission.resolved');
  }

  function relay(permission: Permission): void {
    (bridge as unknown as { _relayEvent(event: unknown): void })._relayEvent({
      type: 'permission.updated',
      properties: permission,
    });
  }

  it('does not resolve an automatic accept until the engine acknowledges it, then recovery resolves once', async () => {
    const { localId, sdkId } = seed('bypassPermissions');
    const permission = { id: 'perm-ack-accept', sessionID: sdkId, permission: 'edit' };
    listPermissionsSpy.mockResolvedValue([permission]);
    replyToPermissionSpy.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    await bridge.recoverPendingPermissions('/tmp/permission-ack');
    await nextTick();

    expect(replyToPermissionSpy).toHaveBeenCalledTimes(1);
    expect(resolvedFrames()).toEqual([]);

    await bridge.recoverPendingPermissions('/tmp/permission-ack');
    await nextTick();

    expect(replyToPermissionSpy).toHaveBeenCalledTimes(2);
    expect(resolvedFrames()).toEqual([
      expect.objectContaining({ sessionId: localId, permissionId: permission.id, decision: 'accept' }),
    ]);
  });

  it('keeps a hard deny reject-only and withholds resolution when its engine reply throws', async () => {
    const { localId, sdkId } = seed('bypassPermissions');
    const permission = {
      id: 'perm-ack-hard-deny',
      sessionID: sdkId,
      permission: 'bash',
      patterns: ['rm -rf /'],
    };
    listPermissionsSpy.mockResolvedValue([permission]);
    replyToPermissionSpy
      .mockRejectedValueOnce(new Error('engine response omitted'))
      .mockResolvedValueOnce(true);

    await bridge.recoverPendingPermissions('/tmp/permission-ack');
    await nextTick();

    expect(replyToPermissionSpy).toHaveBeenCalledWith(
      permission.id,
      'reject',
      expect.stringContaining('Command blocked'),
      '/tmp/permission-ack',
      sdkId,
    );
    expect(replyToPermissionSpy.mock.calls.some((call) => call[1] === 'once')).toBe(false);
    expect(resolvedFrames()).toEqual([]);
    expect(broadcastSpy.mock.calls.map(([frame]) => frame as Record<string, unknown>)).toContainEqual(
      expect.objectContaining({ type: 'tool.denied', sessionId: localId, tool: 'bash' }),
    );

    await bridge.recoverPendingPermissions('/tmp/permission-ack');
    await nextTick();

    expect(replyToPermissionSpy.mock.calls.filter((call) => call[1] === 'reject')).toHaveLength(2);
    expect(resolvedFrames()).toEqual([
      expect.objectContaining({ sessionId: localId, permissionId: permission.id, decision: 'deny' }),
    ]);
  });

  it('deduplicates a live/recovery race until the single automatic reply is acknowledged', async () => {
    const { localId, sdkId } = seed('bypassPermissions');
    const permission = { id: 'perm-ack-race', sessionID: sdkId, permission: 'edit' };
    listPermissionsSpy.mockResolvedValue([permission]);
    let acknowledge: ((ok: boolean) => void) | undefined;
    replyToPermissionSpy.mockReturnValueOnce(new Promise<boolean>((resolve) => {
      acknowledge = resolve;
    }));

    relay(permission);
    await bridge.recoverPendingPermissions('/tmp/permission-ack');

    expect(replyToPermissionSpy).toHaveBeenCalledTimes(1);
    expect(resolvedFrames()).toEqual([]);

    acknowledge!(true);
    await nextTick();

    expect(resolvedFrames()).toEqual([
      expect.objectContaining({ sessionId: localId, permissionId: permission.id, decision: 'accept' }),
    ]);

    relay(permission);
    await bridge.recoverPendingPermissions('/tmp/permission-ack');
    await nextTick();

    expect(replyToPermissionSpy).toHaveBeenCalledTimes(1);
    expect(resolvedFrames()).toEqual([
      expect.objectContaining({ sessionId: localId, permissionId: permission.id, decision: 'accept' }),
    ]);
  });
});
