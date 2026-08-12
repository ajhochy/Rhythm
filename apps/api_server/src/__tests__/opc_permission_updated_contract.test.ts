/**
 * Regression: the bridge must handle the REAL SDK permission event.
 *
 * The SDK (v1.14.49) emits `permission.updated` with a `Permission` payload —
 * there is NO `permission.asked` event. The bridge previously listened for
 * `permission.asked`, so every permission request was silently dropped: any
 * permission-gated tool (write/edit) hung the session forever with no card.
 *
 * These tests drive a real-shape `permission.updated` event and assert the
 * bridge forwards it to the Flutter client (as the internal `permission.asked`
 * WS message), with fields mapped from the Permission shape (id→permissionId,
 * type→toolName, title→summary). They fail against the pre-fix code (which
 * routed `permission.updated` to the generic-event default branch).
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';

const { broadcastSpy, sessionUpdatedSpy, sessionMap, respondSpy } = vi.hoisted(
  () => ({
    broadcastSpy: vi.fn(),
    sessionUpdatedSpy: vi.fn(),
    sessionMap: new Map<string, string>(),
    respondSpy: vi.fn().mockResolvedValue(true),
  }),
);

vi.mock('../services/ws_gateway', () => ({
  broadcast: (msg: unknown) => broadcastSpy(msg),
  broadcastSessionUpdated: (session: unknown) => sessionUpdatedSpy(session),
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    subscribeToEvents: vi.fn().mockResolvedValue(null),
    respondPermission: (...args: unknown[]) => respondSpy(...args),
  },
  opencodeSessionMap: sessionMap,
}));

import { OpencodeStreamBridge } from '../services/opencode_stream_bridge';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

function relayOn(bridge: OpencodeStreamBridge) {
  return (event: Record<string, unknown>): void => {
    (bridge as unknown as { _relayEvent: (e: unknown) => void })._relayEvent(
      event,
    );
  };
}

/** Real v1.14.49 Permission payload (properties of permission.updated). */
function permissionUpdated(sdkId: string) {
  return {
    type: 'permission.updated',
    properties: {
      id: 'perm-abc',
      type: 'edit',
      sessionID: sdkId,
      messageID: 'msg-1',
      title: 'Write to /tm/rhythm_smoke.txt',
      metadata: { filePath: '/tmp/rhythm_smoke.txt' },
      time: { created: 0 },
    },
  };
}

describe('OpencodeStreamBridge — permission.updated (real SDK event) surfaces a card', () => {
  let bridge: OpencodeStreamBridge;
  let relay: (event: Record<string, unknown>) => void;
  const SDK_ID = 'sdk-perm-1';
  let localId: string;

  beforeEach(() => {
    setDb(makeDb());
    sessionMap.clear();
    broadcastSpy.mockClear();
    sessionUpdatedSpy.mockClear();
    respondSpy.mockClear();

    bridge = new OpencodeStreamBridge();
    relay = relayOn(bridge);

    const repo = new AgentSessionsRepository();
    repo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: '/tmp',
      name: 'perm-test',
    });
    localId = repo.listActive()[0].id;
    // Map is local→sdk (opencodeSessionMap.set(session.id, sdkSessionId)).
    sessionMap.set(localId, SDK_ID);
  });

  it('forwards permission.updated to the client as a permission.asked WS message with mapped fields', () => {
    relay(permissionUpdated(SDK_ID));

    const permMsg = broadcastSpy.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .find((m) => m.type === 'permission.asked');

    expect(
      permMsg,
      'bridge must broadcast a permission.asked WS message when the SDK emits permission.updated',
    ).toBeTruthy();
    expect(permMsg!.sessionId).toBe(localId);
    expect(permMsg!.permissionID).toBe('perm-abc'); // from Permission.id
    expect(permMsg!.tool).toBe('edit'); // from Permission.type
    expect(permMsg!.title).toBe('Write to /tm/rhythm_smoke.txt'); // from Permission.title
    expect(permMsg!.directory).toBe('/tmp');
    expect(permMsg!.patterns).toEqual([]);
    expect(permMsg!.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  });

  it('also handles the running binary\'s permission.asked event (older flat shape)', () => {
    // opencode 1.14.40 emits permission.asked with {permissionID,toolName,summary}
    // (NOT the 1.14.49-typed permission.updated/Permission shape). The bridge
    // must handle both, or the gated tool hangs with no card.
    relay({
      type: 'permission.asked',
      properties: {
        sessionID: SDK_ID,
        permissionID: 'perm-xyz',
        toolName: 'write',
        summary: 'Write to /tmp/rhythm_711.txt',
        args: { filePath: '/tmp/rhythm_711.txt' },
      },
    });
    const permMsg = broadcastSpy.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .find((m) => m.type === 'permission.asked');
    expect(permMsg, 'permission.asked must surface a card').toBeTruthy();
    expect(permMsg!.permissionID).toBe('perm-xyz'); // from permissionID
    expect(permMsg!.tool).toBe('write');
    expect(permMsg!.title).toBe('Write to /tmp/rhythm_711.txt');
  });

  it('does NOT route permission.updated to the generic-event branch', () => {
    relay(permissionUpdated(SDK_ID));
    const generic = broadcastSpy.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .find((m) => m.type === 'event' && m.eventType === 'permission.updated');
    expect(
      generic,
      'permission.updated must be handled, not relayed as a generic passthrough event',
    ).toBeUndefined();
  });
});
