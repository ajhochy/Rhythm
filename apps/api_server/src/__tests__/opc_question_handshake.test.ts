/**
 * Regression: the agent "ask question" feature hangs forever.
 *
 * opencode (1.14.x) answers its `question` tool (AskUserQuestion) through a
 * DEDICATED Question API — NOT through `session.input` and NOT through the
 * permission endpoint:
 *
 *   - event  `question.asked`   { id, sessionID, questions, tool:{callID} }
 *   - reply  POST /question/{requestID}/reply  { answers: string[][] }
 *   - reject POST /question/{requestID}/reject
 *
 * Before this fix the bridge never listened for `question.asked`, so it never
 * captured the requestID, and the Flutter card replied via `session.input`
 * (a brand-new user turn). A new prompt does not resolve a pending question,
 * so the `question` tool stayed `status: running` forever → the agent never
 * resumed → the session hung. Reproduced with every model (all route through
 * the same opencode `build` agent + Question API).
 *
 * These tests drive a real-shape `question.asked` event and assert the bridge
 * (1) forwards it to the client as a `question.asked` WS frame carrying both
 * the requestID and the tool callID for correlation, (2) tracks it as a pending
 * question resolvable by callID, and (3) clears it + broadcasts `question.resolved`
 * when opencode emits `question.replied` / `question.rejected`.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';

const { broadcastSpy, sessionUpdatedSpy, sessionMap } = vi.hoisted(() => ({
  broadcastSpy: vi.fn(),
  sessionUpdatedSpy: vi.fn(),
  sessionMap: new Map<string, string>(),
}));

vi.mock('../services/ws_gateway', () => ({
  broadcast: (msg: unknown) => broadcastSpy(msg),
  broadcastSessionUpdated: (session: unknown) => sessionUpdatedSpy(session),
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    subscribeToEvents: vi.fn().mockResolvedValue(null),
  },
  opencodeSessionMap: sessionMap,
}));

import {
  OpencodeStreamBridge,
  type PendingQuestion,
} from '../services/opencode_stream_bridge';

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

/** Real-shape QuestionRequest payload (properties of question.asked). */
function questionAsked(sdkId: string) {
  return {
    type: 'question.asked',
    properties: {
      id: 'que_1',
      sessionID: sdkId,
      questions: [
        {
          header: 'Test question',
          question: 'Which option do you prefer?',
          options: [
            { label: 'Option A', description: 'first' },
            { label: 'Option B', description: 'second' },
          ],
        },
      ],
      tool: { messageID: 'msg_1', callID: 'toolu_1' },
    },
  };
}

describe('OpencodeStreamBridge — question.asked handshake', () => {
  let bridge: OpencodeStreamBridge;
  let relay: (event: Record<string, unknown>) => void;
  const SDK_ID = 'sdk-q-1';
  let localId: string;

  beforeEach(() => {
    setDb(makeDb());
    sessionMap.clear();
    broadcastSpy.mockClear();
    sessionUpdatedSpy.mockClear();

    bridge = new OpencodeStreamBridge();
    relay = relayOn(bridge);

    const repo = new AgentSessionsRepository();
    repo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: '/tmp',
      name: 'q-test',
    });
    localId = repo.listActive()[0].id;
    sessionMap.set(localId, SDK_ID);
  });

  it('forwards question.asked to the client with requestId + callId + questions', () => {
    relay(questionAsked(SDK_ID));

    const qMsg = broadcastSpy.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .find((m) => m.type === 'question.asked');

    expect(
      qMsg,
      'bridge must broadcast a question.asked WS frame when opencode asks a question',
    ).toBeTruthy();
    expect(qMsg!.sessionId).toBe(localId);
    expect(qMsg!.requestId).toBe('que_1');
    expect(qMsg!.callId).toBe('toolu_1');
    expect(Array.isArray(qMsg!.questions)).toBe(true);
  });

  it('tracks the pending question resolvable by callId', () => {
    relay(questionAsked(SDK_ID));
    const pending: PendingQuestion | undefined =
      bridge.getPendingQuestionByCallId(localId, 'toolu_1');
    expect(pending, 'pending question must be lookup-able by tool callId').toBeTruthy();
    expect(pending!.requestId).toBe('que_1');
    expect(pending!.sdkSessionId).toBe(SDK_ID);
  });

  it('does NOT route question.asked to the generic-event branch', () => {
    relay(questionAsked(SDK_ID));
    const generic = broadcastSpy.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .find((m) => m.type === 'event' && m.eventType === 'question.asked');
    expect(
      generic,
      'question.asked must be handled, not relayed as a generic passthrough event',
    ).toBeUndefined();
  });

  it('clears the pending question + broadcasts question.resolved on question.replied', () => {
    relay(questionAsked(SDK_ID));
    expect(bridge.getPendingQuestionByCallId(localId, 'toolu_1')).toBeTruthy();

    relay({
      type: 'question.replied',
      properties: { sessionID: SDK_ID, requestID: 'que_1', answers: [['Option A']] },
    });

    expect(
      bridge.getPendingQuestionByCallId(localId, 'toolu_1'),
      'pending question must be cleared once replied',
    ).toBeUndefined();
    const resolved = broadcastSpy.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .find((m) => m.type === 'question.resolved');
    expect(resolved, 'a question.resolved frame must be broadcast').toBeTruthy();
    expect(resolved!.sessionId).toBe(localId);
    expect(resolved!.requestId).toBe('que_1');
  });

  it('clears the pending question on question.rejected', () => {
    relay(questionAsked(SDK_ID));
    relay({
      type: 'question.rejected',
      properties: { sessionID: SDK_ID, requestID: 'que_1' },
    });
    expect(bridge.getPendingQuestionByCallId(localId, 'toolu_1')).toBeUndefined();
  });
});
