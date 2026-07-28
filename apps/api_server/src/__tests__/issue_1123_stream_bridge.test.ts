import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';

const { sessionMap, childIdleSpy } = vi.hoisted(() => ({
  sessionMap: new Map<string, string>(),
  childIdleSpy: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/ws_gateway', () => ({
  broadcast: vi.fn(),
  broadcastSessionUpdated: vi.fn(),
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    subscribeToEvents: vi.fn().mockResolvedValue(null),
    listPermissions: vi.fn().mockResolvedValue([]),
  },
  opencodeSessionMap: sessionMap,
}));

vi.mock('../services/async_delegation_completion_service', () => ({
  asyncDelegationCompletionService: {
    onChildIdle: childIdleSpy,
    onParentIdle: vi.fn().mockResolvedValue(undefined),
  },
}));

import { OpencodeStreamBridge } from '../services/opencode_stream_bridge';

describe('issue #1123 — stream completion watcher', () => {
  beforeEach(() => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);
    sessionMap.clear();
    childIdleSpy.mockClear();
  });

  it('issue-1123-c2: child session.idle after an assistant turn invokes the async completion watcher once', async () => {
    const repo = new AgentSessionsRepository();
    const parent = repo.insert({
      agentKind: 'manager' as never,
      taskId: null,
      taskTitle: null,
      cwd: '/tmp',
      name: 'parent',
    });
    repo.setSdkSessionId(parent.id, 'sdk-parent');
    const child = repo.upsertChildSession(
      'sdk-child',
      'sdk-parent',
      'Async child (@specialist subagent)',
      '/tmp',
    )!;
    sessionMap.set(parent.id, 'sdk-parent');
    sessionMap.set(child.id, 'sdk-child');

    const bridge = new OpencodeStreamBridge();
    const relay = (event: Record<string, unknown>) =>
      (bridge as unknown as { _relayEvent: (value: unknown) => void })._relayEvent(event);

    relay({
      type: 'message.part.delta',
      properties: {
        part: { sessionID: 'sdk-child' },
        delta: 'done',
        field: 'text',
      },
    });
    relay({ type: 'session.idle', properties: { sessionID: 'sdk-child' } });

    await vi.waitFor(() => expect(childIdleSpy).toHaveBeenCalledOnce());
    expect(childIdleSpy).toHaveBeenCalledWith(child.id);
  });
});
