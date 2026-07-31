/**
 * MSP-003 acceptance contract.
 *
 * Regression caught: pending permissions/questions were split across transient
 * maps and live-only frames, so restart, late attach, reordered events, and a
 * desktop/mobile answer race could orphan or prematurely clear the one engine
 * interaction. These tests drive the real bridge down to a faked engine
 * boundary; they never mock the bridge state or resolution logic under test.
 */
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';

const {
  broadcastSpy,
  listPermissionsSpy,
  listQuestionsSpy,
  replyPermissionSpy,
  replyQuestionSpy,
  sessionMap,
  subscribeGlobalSpy,
} = vi.hoisted(() => ({
  broadcastSpy: vi.fn(),
  listPermissionsSpy: vi.fn(),
  listQuestionsSpy: vi.fn(),
  replyPermissionSpy: vi.fn(),
  replyQuestionSpy: vi.fn(),
  sessionMap: new Map<string, string>(),
  subscribeGlobalSpy: vi.fn(),
}));

vi.mock('../services/ws_gateway', () => ({
  broadcast: (message: unknown) => broadcastSpy(message),
  broadcastSessionUpdated: vi.fn(),
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeSessionMap: sessionMap,
  opencodeClient: {
    subscribeToEvents: vi.fn().mockResolvedValue(null),
    subscribeToGlobalEvents: (...args: unknown[]) => subscribeGlobalSpy(...args),
    listPermissions: (...args: unknown[]) => listPermissionsSpy(...args),
    listQuestions: (...args: unknown[]) => listQuestionsSpy(...args),
    getSessionStatuses: vi.fn().mockResolvedValue({}),
    replyToPermission: (...args: unknown[]) => replyPermissionSpy(...args),
    replyToQuestion: (...args: unknown[]) => replyQuestionSpy(...args),
    rejectQuestion: vi.fn().mockResolvedValue(true),
  },
}));

import { OpencodeStreamBridge } from '../services/opencode_stream_bridge';

type CanonicalInteraction = {
  id: string;
  kind: 'permission' | 'question';
  status: 'pending' | 'resolved' | 'failed';
  sessionId: string;
  sdkSessionId: string;
  callId: string | null;
  payload: Record<string, unknown>;
  resolution: Record<string, unknown> | null;
  error: { message: string; retryable: boolean } | null;
};

type ResolutionRequest = {
  action: 'once' | 'always' | 'reject' | 'reply';
  answers?: string[][];
  source: 'desktop' | 'mobile';
};

type MspBridge = OpencodeStreamBridge & {
  listPendingInteractions?: () => CanonicalInteraction[];
  resolvePendingInteraction?: (
    interactionId: string,
    request: ResolutionRequest,
  ) => Promise<CanonicalInteraction>;
};

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

function relay(bridge: OpencodeStreamBridge, event: Record<string, unknown>): void {
  (bridge as unknown as { _relayEvent: (value: unknown) => void })._relayEvent(event);
}

function permissionRequest(sdkSessionId: string) {
  return {
    id: 'per_stable',
    sessionID: sdkSessionId,
    permission: 'edit',
    patterns: ['src/**'],
    metadata: { filePath: 'src/file.ts' },
    always: ['src/**'],
    tool: { messageID: 'msg_perm', callID: 'call_perm' },
  };
}

function questionRequest(sdkSessionId: string) {
  return {
    id: 'que_stable',
    sessionID: sdkSessionId,
    questions: [
      {
        header: 'Choice',
        question: 'Which option?',
        options: [{ label: 'A', description: 'first' }],
      },
    ],
    tool: { messageID: 'msg_question', callID: 'call_question' },
  };
}

describe('MSP-003 shared pending interactions', () => {
  let bridge: MspBridge;
  let localSessionId: string;
  const sdkSessionId = 'ses_engine_authority';
  const directory = '/tmp/msp-003';

  beforeEach(() => {
    setDb(makeDb());
    sessionMap.clear();
    broadcastSpy.mockReset();
    listPermissionsSpy.mockReset().mockResolvedValue([]);
    listQuestionsSpy.mockReset().mockResolvedValue([]);
    replyPermissionSpy.mockReset().mockResolvedValue(true);
    replyQuestionSpy.mockReset().mockResolvedValue(true);
    subscribeGlobalSpy.mockReset().mockResolvedValue({
      stream: (async function* () {
        await new Promise<void>(() => undefined);
      })(),
      abort: vi.fn(),
    });

    const repo = new AgentSessionsRepository();
    repo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: directory,
      name: 'MSP-003',
    });
    localSessionId = repo.listActive()[0].id;
    repo.setSdkSessionId(localSessionId, sdkSessionId);
    bridge = new OpencodeStreamBridge() as MspBridge;
  });

  afterEach(() => bridge.dispose());

  it('issue-3-c1: bridge connect snapshots both authoritative engine interaction surfaces', async () => {
    listPermissionsSpy.mockResolvedValue([permissionRequest(sdkSessionId)]);
    listQuestionsSpy.mockResolvedValue([questionRequest(sdkSessionId)]);

    await bridge.streamSession(localSessionId, sdkSessionId, directory);
    await vi.waitFor(() => {
      expect(listPermissionsSpy).toHaveBeenCalledWith(directory);
      expect(listQuestionsSpy).toHaveBeenCalledWith(directory);
    });
  });

  it('issue-3-c2: cold maps recover both interaction kinds through sdk_session_id', async () => {
    listPermissionsSpy.mockResolvedValue([permissionRequest(sdkSessionId)]);
    listQuestionsSpy.mockResolvedValue([questionRequest(sdkSessionId)]);

    expect(sessionMap.size).toBe(0);
    await bridge.recoverPendingPermissions(directory);
    await bridge.recoverPendingQuestions(directory);

    expect(sessionMap.get(localSessionId)).toBe(sdkSessionId);
    expect(typeof bridge.listPendingInteractions).toBe('function');
    const interactions = bridge.listPendingInteractions!();
    expect(interactions.map((item) => item.id).sort()).toEqual([
      'per_stable',
      'que_stable',
    ]);
  });

  it('issue-3-c4: permission and question use the same canonical stable-ID schema', async () => {
    sessionMap.set(localSessionId, sdkSessionId);
    listPermissionsSpy.mockResolvedValue([permissionRequest(sdkSessionId)]);
    listQuestionsSpy.mockResolvedValue([questionRequest(sdkSessionId)]);
    await bridge.recoverPendingPermissions(directory);
    await bridge.recoverPendingQuestions(directory);

    expect(typeof bridge.listPendingInteractions).toBe('function');
    const interactions = bridge.listPendingInteractions!();
    expect(interactions).toHaveLength(2);
    for (const interaction of interactions) {
      expect(interaction).toEqual({
        id: expect.stringMatching(/^(per|que)_stable$/),
        kind: expect.stringMatching(/^(permission|question)$/),
        status: 'pending',
        sessionId: localSessionId,
        sdkSessionId,
        callId: expect.any(String),
        payload: expect.any(Object),
        resolution: null,
        error: null,
      });
    }
  });

  it('issue-3-c5: duplicate and reordered events preserve one terminal interaction', async () => {
    sessionMap.set(localSessionId, sdkSessionId);
    const asked = { type: 'question.asked', properties: questionRequest(sdkSessionId) };
    relay(bridge, asked);
    relay(bridge, asked);
    relay(bridge, {
      type: 'question.replied',
      properties: {
        sessionID: sdkSessionId,
        requestID: 'que_stable',
        answers: [['A']],
      },
    });
    relay(bridge, asked);

    expect(typeof bridge.listPendingInteractions).toBe('function');
    expect(bridge.listPendingInteractions!()).toEqual([]);
    const terminal = broadcastSpy.mock.calls
      .map(([message]) => message as CanonicalInteraction & { type?: string; interaction?: CanonicalInteraction })
      .filter((message) => message.type === 'interaction.updated')
      .map((message) => message.interaction)
      .filter((interaction) => interaction?.id === 'que_stable' && interaction.status === 'resolved');
    expect(terminal).toHaveLength(1);
  });

  it('issue-3-c6: simultaneous clients share one engine reply and one terminal result', async () => {
    sessionMap.set(localSessionId, sdkSessionId);
    relay(bridge, {
      type: 'permission.asked',
      properties: permissionRequest(sdkSessionId),
    });

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    replyPermissionSpy.mockImplementation(async () => {
      await gate;
      return true;
    });

    expect(typeof bridge.resolvePendingInteraction).toBe('function');
    const desktop = bridge.resolvePendingInteraction!('per_stable', {
      action: 'once',
      source: 'desktop',
    });
    const mobile = bridge.resolvePendingInteraction!('per_stable', {
      action: 'reject',
      source: 'mobile',
    });
    release();
    const [winner, loser] = await Promise.all([desktop, mobile]);

    expect(replyPermissionSpy).toHaveBeenCalledTimes(1);
    expect(replyPermissionSpy).toHaveBeenCalledWith(
      'per_stable',
      'once',
      undefined,
      directory,
      sdkSessionId,
    );
    expect(loser).toEqual(winner);
    expect(winner.status).toBe('resolved');
    expect(winner.resolution).toMatchObject({ action: 'once', source: 'desktop' });
  });

  it('issue-3-c7: failed engine resolution remains pending with retryable error', async () => {
    sessionMap.set(localSessionId, sdkSessionId);
    relay(bridge, {
      type: 'permission.asked',
      properties: permissionRequest(sdkSessionId),
    });
    replyPermissionSpy.mockResolvedValue(false);

    expect(typeof bridge.resolvePendingInteraction).toBe('function');
    const failed = await bridge.resolvePendingInteraction!('per_stable', {
      action: 'once',
      source: 'desktop',
    });

    expect(failed.status).toBe('failed');
    expect(failed.error).toEqual({
      message: expect.any(String),
      retryable: true,
    });
    expect(bridge.listPendingInteractions!()).toContainEqual(failed);
  });

  it('issue-3-c8: successful resolution broadcasts the canonical terminal state', async () => {
    sessionMap.set(localSessionId, sdkSessionId);
    relay(bridge, {
      type: 'question.asked',
      properties: questionRequest(sdkSessionId),
    });

    expect(typeof bridge.resolvePendingInteraction).toBe('function');
    const result = await bridge.resolvePendingInteraction!('que_stable', {
      action: 'reply',
      answers: [['A']],
      source: 'desktop',
    });

    expect(replyQuestionSpy).toHaveBeenCalledWith(
      'que_stable',
      [['A']],
      directory,
    );
    expect(result.status).toBe('resolved');
    expect(broadcastSpy).toHaveBeenCalledWith({
      v: 1,
      type: 'interaction.updated',
      interaction: result,
    });
  });
});
